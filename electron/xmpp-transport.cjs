const net = require('node:net');
const tls = require('node:tls');
const { EventEmitter } = require('node:events');
const { CertificateVerificationFailure, assessCertificate } = require('./certificate-trust.cjs');

const STARTTLS_NS = 'urn:ietf:params:xml:ns:xmpp-tls';

function taggedError(code, message, phase, cause) {
  const error = new Error(message);
  error.code = code;
  error.phase = phase;
  if (cause) error.cause = cause;
  return error;
}

function tlsIdentityCheck(tlsOptions) {
  return (host, certificate) => {
    const identityError = tls.checkServerIdentity(tlsOptions.identityHost || host, certificate);
    if (identityError) return identityError;
    if (
      tlsOptions.expectedFingerprint &&
      certificate.fingerprint256 !== tlsOptions.expectedFingerprint
    ) {
      return taggedError(
        'CERTIFICATE_PIN_MISMATCH',
        'The certificate fingerprint changed during TLS negotiation.',
        'tls.verify',
      );
    }
    return undefined;
  };
}

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
    const onError = (error) =>
      finish(
        taggedError(
          ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET'].includes(
            error.code,
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

function startTlsSocket(tlsOptions, domain) {
  return class StartTlsSocket extends EventEmitter {
    constructor() {
      super();
      this.socket = null;
      this.secure = true;
    }
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
    write(data, callback) {
      return this.socket.write(data, callback);
    }
  };
}

function certificateSocket(tlsOptions) {
  return class CertificateSocket extends EventEmitter {
    constructor() {
      super();
      this.socket = null;
      this.secure = true;
    }
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
    write(data, callback) {
      return this.socket.write(data, callback);
    }
  };
}

function createXmppTransport(adapter) {
  return {
    installTlsTransport(session, service, tlsOptions, domain) {
      session.transports = session.transports.map((Transport) => {
        let directTls = false;
        try {
          directTls =
            service.startsWith('xmpps:') &&
            Transport.prototype.socketParameters(service) !== undefined;
        } catch {
          directTls = false;
        }
        if (!directTls) return Transport;
        class SessionTlsTransport extends Transport {}
        SessionTlsTransport.prototype.Socket = certificateSocket({
          ...tlsOptions,
          servername: domain || tlsOptions.servername,
          identityHost: domain || tlsOptions.identityHost,
        });
        return SessionTlsTransport;
      });
    },
    installStartTlsTransport(session, service, tlsOptions, domain) {
      session.transports = session.transports.map((Transport) => {
        let tcp = false;
        try {
          tcp =
            service.startsWith('xmpp:') &&
            Transport.prototype.socketParameters(service) !== undefined;
        } catch {
          tcp = false;
        }
        if (!tcp) return Transport;
        class SessionStartTlsTransport extends Transport {}
        SessionStartTlsTransport.prototype.Socket = startTlsSocket(tlsOptions, domain);
        return SessionStartTlsTransport;
      });
    },
    async probeDirectCertificate(endpoint, domain) {
      return new Promise((resolve, reject) => {
        const socket = tls.connect({
          host: endpoint.host,
          port: endpoint.port,
          servername: domain || endpoint.host,
          servername: endpoint.host,
          rejectUnauthorized: false,
        });
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error('CERTIFICATE_PROBE_TIMEOUT'));
        }, 10000);
        const finish = (callback) => {
          clearTimeout(timer);
          socket.removeListener('secureConnect', onSecureConnect);
          socket.removeListener('error', onError);
          callback();
        };
        const onSecureConnect = () => {
          try {
            const certificate = socket.getPeerCertificate(true);
            const authorizationError = socket.authorizationError;
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
        const onError = (error) =>
          finish(() => {
            socket.destroy();
            reject(error);
          });
        socket.once('secureConnect', onSecureConnect);
        socket.once('error', onError);
      });
    },
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
          authorizationError: secureSocket.authorizationError,
          authorized: secureSocket.authorized,
        };
      } finally {
        secureSocket.destroy();
      }
    },
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
        probe.authorizationError,
      );
      if (assessment.error && !assessment.trustable)
        throw new CertificateVerificationFailure(
          'CERTIFICATE_INVALID',
          assessment.error.message,
          assessment.info,
          assessment.error,
        );
      const changed = previous && previous.fingerprintSha256 !== assessment.info.fingerprintSha256;
      if (previous && !changed)
        return {
          ca: previous.certificatePem,
          expectedFingerprint: previous.fingerprintSha256,
          servername: logicalDomain,
          identityHost: logicalDomain,
        };
      if (changed || assessment.trustable) {
        const decision = await adapter.awaitTrustDecision(
          input,
          transportName,
          assessment.info,
          assessment.error,
          changed ? previous : null,
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
              approvedAt: new Date().toISOString(),
            });
          } catch {
            throw new Error('certificate_storage_unavailable');
          }
        }
        return {
          ca: assessment.error ? assessment.info.pem : undefined,
          expectedFingerprint: assessment.info.fingerprintSha256,
          servername: logicalDomain,
          identityHost: logicalDomain,
        };
      }
      return { servername: logicalDomain, identityHost: logicalDomain };
    },
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

module.exports = { createXmppTransport, negotiateStartTls };
