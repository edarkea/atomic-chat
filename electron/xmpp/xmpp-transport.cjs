const net = require('node:net');
const tls = require('node:tls');
const { EventEmitter } = require('node:events');
const {
  CertificateVerificationFailure,
  assessCertificate,
  certificateFingerprint,
} = require('../security/certificate-trust.cjs');

const STARTTLS_NS = 'urn:ietf:params:xml:ns:xmpp-tls';

/**
 * @typedef {Error & {code: string, phase: string, cause?: unknown}} TransportError
 * @typedef {import('node:tls').PeerCertificate} PeerCertificate
 * @typedef {import('node:net').Socket | import('node:tls').TLSSocket} TransportSocket
 * @typedef {import('node:tls').ConnectionOptions & {expectedFingerprint?: string, identityHost?: string, allowIdentityMismatch?: boolean}} TlsOptions
 * @typedef {{host: string, port: number, domain?: string}} XmppEndpoint
 * @typedef {{accountId: string, requestId: string, endpoint: XmppEndpoint}} TlsRequest
 * @typedef {{transport: 'starttls' | 'direct-tls'}} TransportSelection
 * @typedef {{certificate: PeerCertificate, authorizationError?: string | null, authorized: boolean}} CertificateProbe
 * @typedef {{accountId: string, host: string, port: number, transport: 'starttls' | 'direct-tls', fingerprintSha256: string, certificatePem: string, approvedAt: string, identityMismatchAuthorized?: boolean}} TrustedCertificate
 * @typedef {{accountId: string, senderId: number, fingerprintSha256: string, resolve: (decision: 'cancel' | 'trust_once' | 'trust_and_remember') => void}} PendingDecision
 * @typedef {{requestId: string, accountId: string, fingerprintSha256: string, decision: 'cancel' | 'trust_once' | 'trust_and_remember'}} CertificateDecisionInput
 * @typedef {{fingerprintSha256: string, subject: string, issuer: string, validFrom: string, validTo: string, subjectAltNames: string[], chain: Array<{fingerprintSha256: string, subject: string, issuer: string}>, publicKeyBits?: number, signatureAlgorithm?: string, pem: string}} CertificateInfo
 * @typedef {{trustStore?: {getTrustedCertificate: (accountId: string, host: string, port: number, transport: string) => TrustedCertificate | null, upsertTrustedCertificate: (value: TrustedCertificate) => void}, probeDirectCertificate: (endpoint: XmppEndpoint, domain: string) => Promise<CertificateProbe>, probeStartTlsCertificate: (endpoint: XmppEndpoint, domain: string) => Promise<CertificateProbe>, awaitTrustDecision: (input: TlsRequest, transport: string, certificate: CertificateInfo, verificationError: {code: string, message: string} | undefined, previous: TrustedCertificate | null, senderId: number) => Promise<'cancel' | 'trust_once' | 'trust_and_remember'>, pendingDecisions: Map<string, PendingDecision>, activeDecisionBySender: Map<number, string>, emit: (event: unknown) => void}} TransportAdapter
 * @typedef {new (...args: never[]) => object} TransportConstructor
 * @typedef {{transports: TransportConstructor[]}} TransportSession

/**
 * @param {string} code
 * @param {string} message
 * @param {string} phase
 * @param {unknown} [cause]
 * @returns {TransportError}
 */
function taggedError(code, message, phase, cause) {
  const error = new Error(message);
  return Object.assign(error, {
    code,
    phase,
    ...(cause ? { cause } : {}),
  });
}

/**
 * @param {TlsOptions} tlsOptions
 * @returns {(host: string, certificate: PeerCertificate) => Error | undefined}
 */
function tlsIdentityCheck(tlsOptions) {
  return (host, certificate) => {
    if (
      tlsOptions.expectedFingerprint &&
      certificateFingerprint(certificate) !== tlsOptions.expectedFingerprint
    ) {
      return taggedError(
        'CERTIFICATE_PIN_MISMATCH',
        'The certificate fingerprint changed during TLS negotiation.',
        'tls.verify',
      );
    }
    const identityError = tls.checkServerIdentity(tlsOptions.identityHost || host, certificate);
    if (identityError && !(tlsOptions.allowIdentityMismatch && tlsOptions.expectedFingerprint))
      return identityError;
    return undefined;
  };
}

/**
 * @param {string} host
 * @param {number} port
 * @param {string} domain
 * @returns {Promise<import('node:net').Socket>}
 */
function negotiateStartTls(host, port, domain) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let buffer = '';
    let stage = 'connect';
    let settled = false;
    const timer = setTimeout(
      () =>
        finish(
          taggedError('SERVER_UNREACHABLE', 'STARTTLS connection timed out.', 'starttls.connect'),
        ),
      10000,
    );
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener('connect', onConnect);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };
    /** @param {TransportError | undefined} [error] */
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        socket.destroy();
        reject(error);
      } else resolve(socket);
    };
    const onConnect = () => {
      stage = 'features';
      socket.write(
        `<?xml version='1.0'?><stream:stream to='${domain.replaceAll('&', '&amp;').replaceAll("'", '&apos;')}' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' version='1.0'>`,
      );
    };
    /** @param {Buffer} data */
    const onData = (data) => {
      buffer += data.toString('utf8');
      if (stage === 'features') {
        const start = buffer.indexOf('<stream:features');
        const close = start >= 0 ? buffer.indexOf('</stream:features>', start) : -1;
        if (start < 0 || close < 0) return;
        const features = buffer.slice(start, close + '</stream:features>'.length);
        if (
          !features.includes(`xmlns='${STARTTLS_NS}'`) &&
          !features.includes(`xmlns="${STARTTLS_NS}"`)
        ) {
          return finish(
            taggedError(
              'STARTTLS_UNAVAILABLE',
              'The server did not advertise STARTTLS.',
              'starttls.features',
            ),
          );
        }
        stage = 'proceed';
        socket.write(`<starttls xmlns='${STARTTLS_NS}'/>`);
      } else if (stage === 'proceed') {
        if (
          buffer.includes(`<proceed xmlns='${STARTTLS_NS}'`) ||
          buffer.includes(`<proceed xmlns="${STARTTLS_NS}"`)
        )
          finish();
        else if (buffer.includes('<failure'))
          finish(
            taggedError(
              'TLS_NEGOTIATION_FAILED',
              'The server rejected STARTTLS negotiation.',
              'starttls.proceed',
            ),
          );
      }
    };
    /** @param {NodeJS.ErrnoException} error */
    const onError = (error) =>
      finish(
        taggedError(
          ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET'].includes(
            error.code || '',
          )
            ? 'SERVER_UNREACHABLE'
            : 'TLS_NEGOTIATION_FAILED',
          error.message,
          `starttls.${stage}`,
          error,
        ),
      );
    const onClose = () => {
      if (!settled)
        finish(
          taggedError(
            'TLS_NEGOTIATION_FAILED',
            'The server closed the STARTTLS negotiation.',
            `starttls.${stage}`,
          ),
        );
    };
    socket.on('connect', onConnect);
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

/**
 * @param {import('node:net').Socket} rawSocket
 * @param {string} host
 * @param {TlsOptions} tlsOptions
 * @returns {Promise<import('node:tls').TLSSocket>}
 */
function upgradeStartTls(rawSocket, host, tlsOptions) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({
      socket: rawSocket,
      host,
      servername: tlsOptions.servername || host,
      ...tlsOptions,
      rejectUnauthorized: tlsOptions.rejectUnauthorized !== false,
      checkServerIdentity: tlsOptions.checkServerIdentity || tlsIdentityCheck(tlsOptions),
    });
    const timer = setTimeout(() => {
      secureSocket.destroy();
      reject(
        taggedError('TLS_NEGOTIATION_FAILED', 'STARTTLS TLS handshake timed out.', 'tls.handshake'),
      );
    }, 10000);
    secureSocket.once('secureConnect', () => {
      clearTimeout(timer);
      resolve(secureSocket);
    });
    /** @param {NodeJS.ErrnoException} error */
    /** @param {NodeJS.ErrnoException} error */
    secureSocket.once('error', (error) => {
      clearTimeout(timer);
      reject(
        taggedError(
          error.code === 'CERTIFICATE_PIN_MISMATCH'
            ? 'CERTIFICATE_PIN_MISMATCH'
            : 'TLS_NEGOTIATION_FAILED',
          error.message,
          'tls.handshake',
          error,
        ),
      );
    });
  });
}

/**
 * @param {TlsOptions} tlsOptions
 * @param {string} domain
 */
function startTlsSocket(tlsOptions, domain) {
  return class StartTlsSocket extends EventEmitter {
    constructor() {
      super();
      this.socket = null;
      this.secure = true;
    }
    /** @param {{host: string, port: number}} parameters */
    connect(parameters) {
      void negotiateStartTls(parameters.host, parameters.port, domain)
        .then((rawSocket) => upgradeStartTls(rawSocket, parameters.host, tlsOptions))
        .then((secureSocket) => {
          this.socket = secureSocket;
          secureSocket.on('data', (data) => this.emit('data', data));
          secureSocket.on('close', () => this.emit('close'));
          secureSocket.on('error', (error) => this.emit('error', error));
          this.emit('connect');
        })
        .catch((error) => this.emit('error', error));
    }
    end() {
      this.socket?.end();
    }
    /** @param {string | Buffer} data @param {() => void} [callback] */
    write(data, callback) {
      return /** @type {TransportSocket} */ (this.socket).write(data, callback);
    }
  };
}

/** @param {TlsOptions} tlsOptions */
function certificateSocket(tlsOptions) {
  return class CertificateSocket extends EventEmitter {
    constructor() {
      super();
      this.socket = null;
      this.secure = true;
    }
    /** @param {{host: string, port: number}} parameters */
    connect(parameters) {
      this.socket = tls.connect({
        ...parameters,
        ...tlsOptions,
        rejectUnauthorized: true,
        servername: tlsOptions.servername || parameters.host,
        checkServerIdentity: tlsIdentityCheck(tlsOptions),
      });
      this.socket.on('data', (data) => this.emit('data', data));
      this.socket.on('close', () => this.emit('close'));
      this.socket.on('error', (error) => this.emit('error', error));
      this.socket.on('secureConnect', () => this.emit('connect'));
    }
    end() {
      this.socket?.end();
    }
    /** @param {string | Buffer} data @param {() => void} [callback] */
    write(data, callback) {
      return /** @type {TransportSocket} */ (this.socket).write(data, callback);
    }
  };
}

/** @param {TransportAdapter} adapter */
function createXmppTransport(adapter) {
  return {
    /**
     * @param {TransportSession} session
     * @param {string} service
     * @param {TlsOptions} tlsOptions
     * @param {string} domain
     */
    installTlsTransport(session, service, tlsOptions, domain) {
      session.transports = session.transports.map((Transport) => {
        let directTls = false;
        try {
          const prototype = /** @type {{socketParameters: (value: string) => unknown}} */ (
            Transport.prototype
          );
          directTls =
            service.startsWith('xmpps:') && prototype.socketParameters(service) !== undefined;
        } catch {
          directTls = false;
        }
        if (!directTls) return Transport;
        class SessionTlsTransport extends Transport {}
        Object.assign(SessionTlsTransport.prototype, {
          Socket: certificateSocket({
            ...tlsOptions,
            servername: domain || tlsOptions.servername,
            identityHost: domain || tlsOptions.identityHost,
          }),
        });
        return SessionTlsTransport;
      });
    },
    /**
     * @param {TransportSession} session
     * @param {string} service
     * @param {TlsOptions} tlsOptions
     * @param {string} domain
     */
    installStartTlsTransport(session, service, tlsOptions, domain) {
      session.transports = session.transports.map((Transport) => {
        let tcp = false;
        try {
          const prototype = /** @type {{socketParameters: (value: string) => unknown}} */ (
            Transport.prototype
          );
          tcp = service.startsWith('xmpp:') && prototype.socketParameters(service) !== undefined;
        } catch {
          tcp = false;
        }
        if (!tcp) return Transport;
        class SessionStartTlsTransport extends Transport {}
        Object.assign(SessionStartTlsTransport.prototype, {
          Socket: startTlsSocket(tlsOptions, domain),
        });
        return SessionStartTlsTransport;
      });
    },
    /**
     * @param {XmppEndpoint} endpoint
     * @param {string} domain
     * @returns {Promise<CertificateProbe>}
     */
    async probeDirectCertificate(endpoint, domain) {
      return new Promise((resolve, reject) => {
        const socket = tls.connect({
          host: endpoint.host,
          port: endpoint.port,
          servername: domain || endpoint.host,
          rejectUnauthorized: false,
        });
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error('CERTIFICATE_PROBE_TIMEOUT'));
        }, 10000);
        /** @param {() => void} callback */
        const finish = (callback) => {
          clearTimeout(timer);
          socket.removeListener('secureConnect', onSecureConnect);
          socket.removeListener('error', onError);
          callback();
        };
        const onSecureConnect = () => {
          try {
            const certificate = socket.getPeerCertificate(true);
            const authorizationError =
              typeof socket.authorizationError === 'string' ? socket.authorizationError : undefined;
            finish(() => {
              socket.destroy();
              resolve({ certificate, authorizationError, authorized: socket.authorized });
            });
          } catch (error) {
            finish(() => {
              socket.destroy();
              reject(error);
            });
          }
        };
        /** @param {NodeJS.ErrnoException} error */
        const onError = (error) =>
          finish(() => {
            socket.destroy();
            reject(error);
          });
        socket.once('secureConnect', onSecureConnect);
        socket.once('error', onError);
      });
    },
    /**
     * @param {XmppEndpoint} endpoint
     * @param {string} domain
     * @returns {Promise<CertificateProbe>}
     */
    async probeStartTlsCertificate(endpoint, domain) {
      const rawSocket = await negotiateStartTls(endpoint.host, endpoint.port, domain);
      const secureSocket = await upgradeStartTls(rawSocket, endpoint.host, {
        rejectUnauthorized: false,
        servername: domain || endpoint.host,
        identityHost: domain || endpoint.host,
        checkServerIdentity: (host, certificate) =>
          tls.checkServerIdentity(domain || host, certificate),
      });
      try {
        return {
          certificate: secureSocket.getPeerCertificate(true),
          authorizationError:
            typeof secureSocket.authorizationError === 'string'
              ? secureSocket.authorizationError
              : undefined,
          authorized: secureSocket.authorized,
        };
      } finally {
        secureSocket.destroy();
      }
    },
    /**
     * @param {TlsRequest} input
     * @param {number} senderId
     * @param {TransportSelection} transport
     */
    async resolveTlsOptions(input, senderId, transport) {
      const endpoint = input.endpoint;
      const transportName = transport.transport;
      const logicalDomain = endpoint.domain || endpoint.host;
      let previous = null;
      try {
        previous =
          adapter.trustStore?.getTrustedCertificate(
            input.accountId,
            endpoint.host,
            endpoint.port,
            transportName,
          ) || null;
      } catch {
        throw new Error('certificate_storage_unavailable');
      }
      const probe =
        transportName === 'direct-tls'
          ? await adapter.probeDirectCertificate(endpoint, logicalDomain)
          : await adapter.probeStartTlsCertificate(endpoint, logicalDomain);
      const assessment = assessCertificate(
        logicalDomain,
        probe.certificate,
        probe.authorized,
        typeof probe.authorizationError === 'string' ? probe.authorizationError : undefined,
      );
      if (assessment.error && !assessment.trustable)
        throw new CertificateVerificationFailure(
          'CERTIFICATE_INVALID',
          assessment.error.message,
          assessment.info,
          assessment.error,
        );
      const changed = previous && previous.fingerprintSha256 !== assessment.info.fingerprintSha256;
      const identityMismatch = assessment.error?.code === 'CERTIFICATE_IDENTITY_MISMATCH';
      const approvedIdentityMismatch = Boolean(previous?.identityMismatchAuthorized);
      const previousForDialog = previous
        ? {
            accountId: previous.accountId,
            host: previous.host,
            port: previous.port,
            transport: previous.transport,
            fingerprintSha256: previous.fingerprintSha256,
            certificatePem: previous.certificatePem,
            approvedAt: previous.approvedAt,
          }
        : null;
      if (previous && !changed && (!identityMismatch || approvedIdentityMismatch))
        return {
          ca: previous.certificatePem,
          expectedFingerprint: previous.fingerprintSha256,
          allowIdentityMismatch: approvedIdentityMismatch,
          servername: logicalDomain,
          identityHost: logicalDomain,
        };
      if (changed || assessment.trustable) {
        const decision = await adapter.awaitTrustDecision(
          input,
          transportName,
          assessment.info,
          assessment.error,
          changed ? previousForDialog : null,
          senderId,
        );
        if (decision === 'cancel')
          throw new CertificateVerificationFailure(
            'CERTIFICATE_REJECTED',
            'La conexión fue cancelada porque no se aceptó el certificado.',
            assessment.info,
          );
        if (decision === 'trust_and_remember') {
          if (!adapter.trustStore) throw new Error('certificate_storage_unavailable');
          try {
            adapter.trustStore.upsertTrustedCertificate({
              accountId: input.accountId,
              host: endpoint.host,
              port: endpoint.port,
              transport: transportName,
              fingerprintSha256: assessment.info.fingerprintSha256,
              certificatePem: assessment.info.pem,
              identityMismatchAuthorized: identityMismatch,
              approvedAt: new Date().toISOString(),
            });
          } catch {
            throw new Error('certificate_storage_unavailable');
          }
        }
        return {
          ca: assessment.error ? assessment.info.pem : undefined,
          expectedFingerprint: assessment.info.fingerprintSha256,
          allowIdentityMismatch: identityMismatch,
          servername: logicalDomain,
          identityHost: logicalDomain,
        };
      }
      return { servername: logicalDomain, identityHost: logicalDomain };
    },
    /**
     * @param {TlsRequest} input
     * @param {string} transport
     * @param {CertificateInfo} certificate
     * @param {{code: string, message: string} | undefined} verificationError
     * @param {TrustedCertificate | null} previous
     * @param {number} senderId
     * @returns {Promise<'cancel' | 'trust_once' | 'trust_and_remember'>}
     */
    awaitTrustDecision(input, transport, certificate, verificationError, previous, senderId) {
      return new Promise((resolve) => {
        const previousRequestId = adapter.activeDecisionBySender.get(senderId);
        if (previousRequestId) {
          const previousDecision = adapter.pendingDecisions.get(previousRequestId);
          adapter.pendingDecisions.delete(previousRequestId);
          previousDecision?.resolve('cancel');
        }
        const timeout = setTimeout(() => {
          if (adapter.pendingDecisions.has(input.requestId)) {
            adapter.pendingDecisions.delete(input.requestId);
            if (adapter.activeDecisionBySender.get(senderId) === input.requestId)
              adapter.activeDecisionBySender.delete(senderId);
            resolve('cancel');
          }
        }, 300000);
        adapter.pendingDecisions.set(input.requestId, {
          accountId: input.accountId,
          senderId,
          fingerprintSha256: certificate.fingerprintSha256,
          resolve: (decision) => {
            clearTimeout(timeout);
            resolve(decision);
          },
        });
        adapter.activeDecisionBySender.set(senderId, input.requestId);
        adapter.emit({
          targetSenderId: senderId,
          type: 'certificate.trustRequired',
          payload: {
            requestId: input.requestId,
            accountId: input.accountId,
            host: input.endpoint.host,
            port: input.endpoint.port,
            transport,
            certificate,
            ...(verificationError ? { verificationError } : {}),
            ...(previous ? { previous } : {}),
          },
        });
      });
    },
    /**
     * @param {number} senderId
     * @param {CertificateDecisionInput} input
     * @returns {void}
     */
    decideCertificateTrust(senderId, input) {
      const pending = adapter.pendingDecisions.get(input.requestId);
      if (
        !pending ||
        pending.senderId !== senderId ||
        pending.accountId !== input.accountId ||
        pending.fingerprintSha256 !== input.fingerprintSha256
      )
        throw new Error('CERTIFICATE_DECISION_CONFLICT');
      if (!['cancel', 'trust_once', 'trust_and_remember'].includes(input.decision))
        throw new Error('INVALID_INPUT');
      adapter.pendingDecisions.delete(input.requestId);
      if (adapter.activeDecisionBySender.get(senderId) === input.requestId)
        adapter.activeDecisionBySender.delete(senderId);
      pending.resolve(input.decision);
    },
    /** @param {string} accountId @returns {void} */
    cancelPendingDecision(accountId) {
      for (const [requestId, pending] of adapter.pendingDecisions)
        if (pending.accountId === accountId) {
          adapter.pendingDecisions.delete(requestId);
          if (adapter.activeDecisionBySender.get(pending.senderId) === requestId)
            adapter.activeDecisionBySender.delete(pending.senderId);
          pending.resolve('cancel');
        }
    },
  };
}

module.exports = { createXmppTransport, negotiateStartTls, tlsIdentityCheck };
