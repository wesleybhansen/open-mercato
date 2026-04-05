/**
 * App-level bootstrap file
 *
 * This thin wrapper imports generated files and passes them to the
 * shared bootstrap factory. The actual bootstrap logic lives in
 * @open-mercato/shared/lib/bootstrap.
 *
 * NOTE: All generated imports use `import` statements (static), but
 * the bootstrap function is created lazily to avoid accessing `modules`
 * during ES module evaluation. Turbopack can evaluate this file before
 * modules.generated.ts finishes its imports, causing
 * "Cannot access 'modules' before initialization".
 * By wrapping in a getter function, we defer access to runtime.
 */

// Register app dictionary loader before bootstrap (required for i18n in standalone packages)
import { registerAppDictionaryLoader } from '@open-mercato/shared/lib/i18n/server'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'

registerAppDictionaryLoader(async (locale: Locale): Promise<Record<string, unknown>> => {
  switch (locale) {
    case 'en':
      return import('./i18n/en.json').then((m) => m.default)
    case 'pl':
      return import('./i18n/pl.json').then((m) => m.default)
    case 'es':
      return import('./i18n/es.json').then((m) => m.default)
    case 'de':
      return import('./i18n/de.json').then((m) => m.default)
    default:
      return import('./i18n/en.json').then((m) => m.default)
  }
})

// Generated imports (static - works with bundlers)
// These are import statements so Turbopack can resolve them,
// but we access the values lazily via getGeneratedData().
import * as _modules from '@/.mercato/generated/modules.generated'
import * as _entities from '@/.mercato/generated/entities.generated'
import * as _di from '@/.mercato/generated/di.generated'
import * as _entityIds from '@/.mercato/generated/entities.ids.generated'
import * as _entityFields from '@/.mercato/generated/entity-fields-registry'
import * as _dashboardWidgets from '@/.mercato/generated/dashboard-widgets.generated'
import * as _injectionWidgets from '@/.mercato/generated/injection-widgets.generated'
// Side-effect: registers translatable fields (must be before injection-tables which reads the registry)
import '@/.mercato/generated/translations-fields.generated'
import * as _injectionTables from '@/.mercato/generated/injection-tables.generated'
import * as _search from '@/.mercato/generated/search.generated'
import * as _events from '@/.mercato/generated/events.generated'
import { registerEventModuleConfigs } from '@open-mercato/shared/modules/events'
import * as _analytics from '@/.mercato/generated/analytics.generated'
import * as _enrichers from '@/.mercato/generated/enrichers.generated'
import * as _interceptors from '@/.mercato/generated/interceptors.generated'
import * as _componentOverrides from '@/.mercato/generated/component-overrides.generated'
import * as _guards from '@/.mercato/generated/guards.generated'
import * as _commandInterceptors from '@/.mercato/generated/command-interceptors.generated'
import * as _notificationHandlers from '@/.mercato/generated/notification-handlers.generated'
import * as _messageTypes from '@/.mercato/generated/message-types.generated'
import * as _messageObjects from '@/.mercato/generated/message-objects.generated'
import { registerMessageTypes } from '@open-mercato/core/modules/messages/lib/message-types-registry'
import { registerMessageObjectTypes } from '@open-mercato/core/modules/messages/lib/message-objects-registry'

// Bootstrap factory from shared package
import { createBootstrap, isBootstrapped } from '@open-mercato/shared/lib/bootstrap'

// Lazy bootstrap: the generated namespace imports above are live bindings.
// By deferring access to `_modules.modules` etc. until bootstrap() is called
// (at runtime, not module evaluation), we avoid the TDZ error.
let _bootstrap: (() => void) | null = null

export function bootstrap(): void {
  if (!_bootstrap) {
    // Register event/message configs on first call
    registerEventModuleConfigs(_events.eventModuleConfigs)
    registerMessageTypes(_messageTypes.messageTypes, { replace: true })
    registerMessageObjectTypes(_messageObjects.messageObjectTypes, { replace: true })

    _bootstrap = createBootstrap({
      modules: _modules.modules,
      entities: _entities.entities,
      diRegistrars: _di.diRegistrars,
      entityIds: _entityIds.E,
      entityFieldsRegistry: _entityFields.entityFieldsRegistry,
      dashboardWidgetEntries: _dashboardWidgets.dashboardWidgetEntries,
      injectionWidgetEntries: _injectionWidgets.injectionWidgetEntries,
      injectionTables: _injectionTables.injectionTables,
      searchModuleConfigs: _search.searchModuleConfigs,
      analyticsModuleConfigs: _analytics.analyticsModuleConfigs,
      enricherEntries: _enrichers.enricherEntries,
      interceptorEntries: _interceptors.interceptorEntries,
      componentOverrideEntries: _componentOverrides.componentOverrideEntries,
      guardEntries: _guards.guardEntries,
      commandInterceptorEntries: _commandInterceptors.commandInterceptorEntries,
      notificationHandlerEntries: _notificationHandlers.notificationHandlerEntries,
    })
  }
  _bootstrap()
}

export { isBootstrapped }
