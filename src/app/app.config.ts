import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { corePortProviders } from './core/ports/port-providers';
import { ThemeService } from './core/theme.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    ...corePortProviders,
    provideAppInitializer(() => inject(ThemeService).initialize()),
  ],
};
