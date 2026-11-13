import type { AppError, AppErrorCode } from '../../core/domain';

export const STICKER_SENDING_DISABLED_MESSAGE =
  'El envío de stickers está temporalmente deshabilitado';

const STICKER_SEND_ERROR_MESSAGES: Readonly<Partial<Record<AppErrorCode, string>>> = {
  INVALID_INPUT: 'La solicitud del sticker no es válida.',
  UNAUTHORIZED: 'La ventana o la cuenta ya no están autorizadas para enviar este sticker.',
  NOT_CONNECTED: 'La cuenta ya no está conectada al servidor XMPP.',
  TIMEOUT: 'El envío del sticker excedió el tiempo de espera.',
  UNSUPPORTED: 'El servidor no ofrece XEP-0363/HTTP Upload; requiere configuración del servidor.',
  TRANSPORT_FAILED: 'Falló HTTP Upload o el transporte XMPP durante el envío.',
  MEDIA_PREVIEW_UNAVAILABLE: 'La fuente local del sticker ya no está disponible.',
  MEDIA_TYPE_UNSUPPORTED: 'El sticker debe ser una imagen PNG o JPEG estática.',
  MEDIA_SIZE_EXCEEDED: 'El sticker supera el tamaño máximo permitido por el servidor.',
  MEDIA_DIMENSIONS_INVALID: 'Las dimensiones del sticker no están permitidas.',
  MEDIA_DECODE_FAILED: 'El sticker no pudo validarse de forma segura.',
  STORAGE_FAILED: 'No fue posible leer o guardar el sticker localmente.',
  RESOURCE_CONSTRAINT: 'Se alcanzó el límite local de stickers o almacenamiento.',
  CONFLICT: 'El envío entra en conflicto con otra operación del mismo mensaje.',
  SEND_IN_PROGRESS: 'El envío del sticker sigue pendiente; no se repetirá automáticamente.',
  SEND_RESULT_UNKNOWN:
    'El servidor no confirmó si el sticker fue enviado; no se repetirá automáticamente.',
  INTERNAL: 'No fue posible completar el envío del sticker.',
};

export function stickerSendErrorMessage(error: Pick<AppError, 'code' | 'message'>): string {
  if (error.code === 'UNSUPPORTED' && error.message === STICKER_SENDING_DISABLED_MESSAGE)
    return STICKER_SENDING_DISABLED_MESSAGE;
  return (
    STICKER_SEND_ERROR_MESSAGES[error.code] || 'No fue posible completar el envío del sticker.'
  );
}
