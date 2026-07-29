import { Routes } from '@angular/router';

export const OFFLINE_TEST_ROUTES: Routes = [
  {
    path: '_test/offline-persistence',
    loadComponent: () =>
      import('./offline-persistence-harness').then(
        (module) => module.OfflinePersistenceHarness,
      ),
  },
];
