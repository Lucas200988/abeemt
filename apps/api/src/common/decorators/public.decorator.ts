import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Abre uma rota que, por padrão, exigiria autenticação. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
