import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { setFormatLocale } from './format';

/**
 * Lightweight i18n for the dashboard. No dependencies: a flat dictionary per
 * language, a `t(key, vars)` lookup, and a provider that remembers the choice
 * in localStorage. English is the default; add a language by adding its block
 * to `dictionaries` below. Keys missing from a non-default language fall back
 * to English so a partial translation never shows a raw key.
 */

export type Lang = 'en' | 'es';

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
];

const STORAGE_KEY = 'ml_lang';

type Dict = Record<string, string>;

const en: Dict = {
  // Login
  'login.welcome': 'Welcome back',
  'login.subtitle': 'Revenue-first analytics for your websites.',
  'login.password': 'Password',
  'login.signIn': 'Sign in',
  'login.signingIn': 'Signing in…',

  // Toolbar — periods
  'period.today': 'Today',
  'period.yesterday': 'Yesterday',
  'period.24h': 'Last 24 hours',
  'period.48h': 'Last 2 days',
  'period.7d': 'Last 7 days',
  'period.30d': 'Last 30 days',
  'period.90d': 'Last 90 days',
  'period.12m': 'Last 12 months',
  'period.all': 'All time',
  // Toolbar — granularities
  'granularity.hour': 'Hourly',
  'granularity.day': 'Daily',
  'granularity.week': 'Weekly',
  'granularity.month': 'Monthly',
  // Toolbar — controls
  'toolbar.settings': '⚙️ Site settings & install',
  'toolbar.allWebsites': '＋ All websites',
  'toolbar.customRange': 'Custom range',
  'toolbar.apply': 'Apply',
  'toolbar.prevPeriod': 'Previous period',
  'toolbar.nextPeriod': 'Next period',
  'toolbar.refresh': 'Refresh',
  'toolbar.language': 'Language',

  // Metrics
  'metric.visitors': 'Visitors',
  'metric.revenue': 'Revenue',
  'metric.conversionRate': 'Conversion rate',
  'metric.revenuePerVisitor': 'Revenue per visitor',
  'metric.bounceRate': 'Bounce rate',
  'metric.sessionTime': 'Session time',
  'metric.onlineUsers': 'Online users',
  'metric.vsPrevious': 'vs previous period',

  // Common
  'common.loading': 'Loading…',
  'common.noData': 'No data yet',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.delete': 'Delete',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.direct': 'Direct',
  'common.directNone': 'Direct/None',
  'common.unknown': 'Unknown',
  'common.none': '(none)',
  'common.ago': '{time} ago',

  // Sites
  'sites.addWebsite': 'Add a website',
  'sites.addWebsiteBtn': '+ Add website',
  'sites.logOut': 'Log out',
  'sites.yourWebsites': 'Your websites',
  'sites.visitors24h': 'visitors in the last 24h',
  'sites.online': '{n} online',
  'sites.empty': 'No websites yet. Add your first one to get a tracking snippet.',
  'sites.domain': 'Domain',
  'sites.domainPlaceholder': 'example.com',
  'sites.subdomainsNote': 'Subdomains (app.example.com) are tracked under the same site.',
  'sites.name': 'Name',
  'sites.namePlaceholder': 'My SaaS',
  'sites.timezone': 'Timezone',
  'sites.currency': 'Revenue currency',
  'sites.addWebsiteSubmit': 'Add website',
  'sites.signOut': 'Sign out',

  // Common (extra)
  'common.clearAll': 'Clear all',
  'common.removeFilter': 'Remove filter',
  'common.visitors': 'Visitors',
  'common.revenue': 'Revenue',
  'common.pageviews': 'Pageviews',
  'common.customers': 'Customers',
  'common.conversion': 'Conversion',
  'common.rotate': 'Rotate',
  'common.search': 'Search…',

  // Dashboard
  'dashboard.siteNotFound': 'Site not found.',
  'dashboard.backToWebsites': 'Back to websites',
  'dashboard.filterIs': 'is',
  'dashboard.timesIn': 'Times in {tz}',
  'dashboard.revenueIn': 'Revenue in {currency}',
  'dashboard.settingsInstall': 'Settings & install',
  // Dashboard — filter dimension labels
  'dashboard.filter.channel': 'Channel',
  'dashboard.filter.source': 'Referrer',
  'dashboard.filter.utm_campaign': 'Campaign',
  'dashboard.filter.utm_term': 'Keyword',
  'dashboard.filter.utm_source': 'UTM source',
  'dashboard.filter.utm_medium': 'UTM medium',
  'dashboard.filter.ref': 'Ref',
  'dashboard.filter.country': 'Country',
  'dashboard.filter.region': 'Region',
  'dashboard.filter.city': 'City',
  'dashboard.filter.browser': 'Browser',
  'dashboard.filter.os': 'OS',
  'dashboard.filter.device': 'Device',
  'dashboard.filter.page': 'Visited page',
  'dashboard.filter.entry_page': 'Entry page',
  'dashboard.filter.hostname': 'Hostname',
  'dashboard.filter.goal': 'Completed goal',

  // Panel — tab labels
  'panel.tab.channel': 'Channel',
  'panel.tab.source': 'Referrer',
  'panel.tab.campaign': 'Campaign',
  'panel.tab.keyword': 'Keyword',
  'panel.tab.country': 'Country',
  'panel.tab.region': 'Region',
  'panel.tab.city': 'City',
  'panel.tab.page': 'Page',
  'panel.tab.entry_page': 'Entry page',
  'panel.tab.exit_link': 'Exit link',
  'panel.tab.hostname': 'Hostname',
  'panel.tab.browser': 'Browser',
  'panel.tab.os': 'OS',
  'panel.tab.device': 'Device',
  // Panel — controls & table
  'panel.sortHint': 'Sort by visitors or revenue',
  'panel.noData': 'No data for this period',
  'panel.details': '⛶ Details',
  'panel.clickToFilter': 'Click to filter',
  'panel.revPerVisitor': 'Rev/visitor',
  'panel.convShort': 'Conv.',

  // Overview
  'overview.online': 'Online',
  'overview.showHide': 'Show/hide on chart',
  'overview.revenuePerVisitor': 'Revenue/visitor',

  // Goals panel — tabs
  'goals.tab.goals': 'Goals',
  'goals.tab.funnel': 'Funnel',
  'goals.tab.users': 'Users',
  'goals.tab.journey': 'Journey',
  'goals.search': '🔍 Search',
  // Goals tab
  'goals.empty.prefix': 'No goals yet. Add',
  'goals.empty.middle': 'to any button, or call',
  'goals.empty.suffix': '.',
  'goals.col.goal': 'Goal',
  'goals.col.completions': 'Completions',
  'goals.filterByGoal': 'Filter by visitors who completed this goal',
  // Funnels
  'goals.funnel.newFunnel': '+ New funnel',
  'goals.funnel.deleteConfirm': 'Delete funnel "{name}"?',
  'goals.funnel.visitorsDot': '{n} visitors',
  'goals.funnel.dropoff': '−{pct} drop-off',
  'goals.funnel.stepsHelp': 'Steps are counted in order per visitor. Page paths support wildcards like {wildcard}.',
  'goals.funnel.defaultName': 'Signup funnel',
  'goals.funnel.namePlaceholder': 'Funnel name',
  'goals.funnel.typePage': 'Page',
  'goals.funnel.typeGoal': 'Goal',
  'goals.funnel.pagePlaceholder': '/pricing',
  'goals.funnel.goalPlaceholder': 'signup',
  'goals.funnel.addStep': '+ Step',
  'goals.funnel.save': 'Save funnel',
  // Journey
  'goals.journey.empty': 'No payments in this period. Connect Dodo Payments in site settings to see who paid and where they came from.',
  'goals.journey.unmatched': '{n} payment not linked to a visitor yet.',
  'goals.journey.unmatchedPlural': '{n} payments not linked to a visitor yet.',
  'goals.journey.why': 'Why?',
  'goals.journey.matching': 'Matching…',
  'goals.journey.matched': 'Matched {matched} of {checked}',
  'goals.journey.tryMatch': 'Try matching again',
  'goals.journey.matchedYes': '✓ matched',
  'goals.journey.matchedNo': '✗ not matched',
  'goals.journey.col.visitor': 'Visitor',
  'goals.journey.col.source': 'Source',
  'goals.journey.col.spent': 'Spent',
  'goals.journey.col.timeToComplete': 'Time to complete',
  'goals.journey.col.completedAt': 'Completed at',
  'goals.journey.matchedBy': 'matched by {reason}',
  'goals.journey.matchedByHint': 'How this payment was linked to the visitor',
  'goals.journey.notAttributed': 'Not attributed',
  'goals.journey.notAttributedHint': 'No visitor id in the payment metadata, and no return-page, email or timing match',
  'goals.journey.badge.returning': 'Returning',
  'goals.journey.badge.customer': 'Customer',
  'goals.journey.visit': '{n} visit',
  'goals.journey.visits': '{n} visits',
  // Match reasons
  'goals.match.return_page': 'return page',
  'goals.match.customer': 'earlier payment',
  'goals.match.email': 'email',
  'goals.match.timing': 'checkout click timing',
  // Users
  'goals.users.empty': 'No visitors in this period.',
  'goals.users.col.visits': 'Visits',
  'goals.users.col.pages': 'Pages',
  'goals.users.col.time': 'Time',
  'goals.users.col.lastSeen': 'Last seen',
  'goals.users.badge.customer': 'Customer',
  'goals.showAll': 'Show all {total}',
  'goals.visitorFallback': 'Visitor {id}',

  // Visitor modal
  'visitor.profile': 'Visitor profile',
  'visitor.fallback': 'Visitor {id}',
  'visitor.stat.firstSource': 'First source',
  'visitor.stat.visits': 'Visits',
  'visitor.stat.totalSpent': 'Total spent',
  'visitor.stat.timeToFirstPayment': 'Time to first payment',
  'visitor.campaign': 'campaign: {value}',
  'visitor.ref': 'ref: {value}',
  'visitor.goalOn': 'on {path}',
  'visitor.leftTo': 'Left to {target}',
  'visitor.refund': 'Refund',
  'visitor.paid': 'Paid',
  'visitor.payment': 'Payment',
  'visitor.renewal': 'Renewal',
  'visitor.payments': 'Payments',

  // Settings
  'settings.backDashboard': '← Dashboard',
  'settings.s1.title': '1. Install the tracking script',
  'settings.s1.descPre': 'Paste this in the',
  'settings.s1.descPost': 'of every page on {domain} (and its subdomains).',
  'settings.s1.nextjsExample': 'Next.js / React example',
  'settings.s1.beatAdblockers': 'Beat ad blockers (recommended for accuracy)',
  'settings.s1.beatAdblockersDesc': 'Ad blockers can block third-party analytics domains. Serve the script and endpoint from your own domain with a rewrite, then point the script at it:',
  'settings.s1.excludePre': 'Exclude your own visits: open',
  'settings.s1.excludePost': 'once in each browser you use.',
  'settings.s2.title': '2. Track button clicks & goals',
  'settings.s2.desc': 'Goals show up in the Goals tab and can be used in funnels and filters.',
  'settings.s2.outbound': 'Outbound link clicks are tracked automatically (Exit link tab).',
  'settings.s3.title': '3. Connect Dodo Payments (revenue attribution)',
  'settings.s3.desc': 'Payments are linked to the visitor who paid and credited to the source that brought them.',
  'settings.s3.step1Pre': 'In Dodo Payments →',
  'settings.s3.step1DevWebhooks': 'Developer → Webhooks',
  'settings.s3.step1Mid': ', add this endpoint and subscribe to',
  'settings.s3.step1And': 'and',
  'settings.s3.step1End': ':',
  'settings.s3.step2Pre': "Paste the webhook's",
  'settings.s3.step2SigningSecret': 'signing secret',
  'settings.s3.step2Mid': '(starts with',
  'settings.s3.step2End': '):',
  'settings.s3.secretPlaceholder': 'whsec_...',
  'settings.s3.secretSaved': 'Webhook secret saved',
  'settings.s3.secretConfigured': '✓ Secret configured',
  'settings.s3.step3': 'Pass the visitor cookies as metadata when you create a checkout (this is what makes attribution exact):',
  'settings.s3.step3NotePre': 'Using Dodo',
  'settings.s3.step3NotePaymentLinks': 'payment links',
  'settings.s3.step3NoteMid': "(checkout.dodopayments.com/buy/…) instead? The script adds the metadata to those links automatically when clicked, but it doesn't always reach the payment, so also set the return URL (step 4). In the browser you can also read the ids with",
  'settings.s3.step3NoteEnd': '.',
  'settings.s3.step3Note2': 'If metadata is missing, Minilytics still links the payment when the buyer lands back on your site, when their email matches a visitor you {identify}, when it\'s a renewal of an earlier payment, or when exactly one visitor clicked a checkout link shortly before paying. The Journey tab shows how each payment was matched.',
  'settings.s3.step4Recommended': 'Recommended:',
  'settings.s3.step4Mid': "set your product's",
  'settings.s3.step4ReturnUrl': 'return / redirect URL',
  'settings.s3.step4End': "in Dodo to a page on your site, e.g. {url}. Dodo adds {param} to it, which lets Minilytics link the payment to the exact visitor even when metadata doesn't come through (for example with payment links).",
  'settings.api.title': 'Other payment providers / server-side API',
  'settings.api.desc': "Send payments or goals from your backend using this site's API key.",
  'settings.api.rotateConfirm': 'Rotate the API key? The old key stops working immediately.',
  'settings.general.title': 'General',
  'settings.general.name': 'Name',
  'settings.general.domain': 'Domain',
  'settings.general.timezone': 'Timezone',
  'settings.general.currency': 'Revenue currency',
  'settings.general.saveChanges': 'Save changes',
  'settings.saved': 'Saved',
  'settings.danger.title': 'Danger zone',
  'settings.danger.delete': 'Delete site and all data',
  'settings.danger.deleteConfirm': 'Type {domain} to delete this site and all of its data',
  'settings.ai.title': '✨ Set up with AI',
  'settings.ai.desc': "Copy this prompt into Claude Code, Cursor or any coding AI opened in your project. It installs the script, connects Dodo Payments attribution, identifies users and adds button goals, using this site's real values. It asks you only what it can't find in your code.",
  'settings.ai.copy': 'Copy AI prompt',
  'settings.ai.copied': '✓ Copied',
  'settings.ai.hidePrompt': 'Hide prompt',
  'settings.ai.previewPrompt': 'Preview prompt',
  'settings.ai.note': "The AI handles the code. You still connect the Dodo webhook yourself (step 3 below), because that's done in Dodo's dashboard.",
  'settings.link.title': 'Link builder',
  'settings.link.desc': 'X, Medium and others hide which exact post sent a visitor. Use a tagged link in each post and it shows up by name in Referrer → Campaign, including the revenue it made.',
  'settings.link.page': 'Page',
  'settings.link.whereYouPost': 'Where you post it',
  'settings.link.postName': 'Post name (campaign)',
  'settings.link.postNamePlaceholder': 'launch-tweet, seo-guide-article…',
  'settings.link.shorterPre': 'Shorter alternative:',
  'settings.link.shorterPost': 'also works and shows up as the referrer.',
};

const es: Dict = {
  // Login
  'login.welcome': 'Bienvenido de nuevo',
  'login.subtitle': 'Analíticas enfocadas en ingresos para tus sitios web.',
  'login.password': 'Contraseña',
  'login.signIn': 'Iniciar sesión',
  'login.signingIn': 'Iniciando sesión…',

  // Toolbar — periods
  'period.today': 'Hoy',
  'period.yesterday': 'Ayer',
  'period.24h': 'Últimas 24 horas',
  'period.48h': 'Últimos 2 días',
  'period.7d': 'Últimos 7 días',
  'period.30d': 'Últimos 30 días',
  'period.90d': 'Últimos 90 días',
  'period.12m': 'Últimos 12 meses',
  'period.all': 'Todo el tiempo',
  // Toolbar — granularities
  'granularity.hour': 'Por hora',
  'granularity.day': 'Diario',
  'granularity.week': 'Semanal',
  'granularity.month': 'Mensual',
  // Toolbar — controls
  'toolbar.settings': '⚙️ Configuración e instalación',
  'toolbar.allWebsites': '＋ Todos los sitios',
  'toolbar.customRange': 'Rango personalizado',
  'toolbar.apply': 'Aplicar',
  'toolbar.prevPeriod': 'Periodo anterior',
  'toolbar.nextPeriod': 'Periodo siguiente',
  'toolbar.refresh': 'Actualizar',
  'toolbar.language': 'Idioma',

  // Metrics
  'metric.visitors': 'Visitantes',
  'metric.revenue': 'Ingresos',
  'metric.conversionRate': 'Tasa de conversión',
  'metric.revenuePerVisitor': 'Ingreso por visitante',
  'metric.bounceRate': 'Tasa de rebote',
  'metric.sessionTime': 'Tiempo de sesión',
  'metric.onlineUsers': 'Usuarios en línea',
  'metric.vsPrevious': 'vs periodo anterior',

  // Common
  'common.loading': 'Cargando…',
  'common.noData': 'Aún no hay datos',
  'common.copy': 'Copiar',
  'common.copied': 'Copiado',
  'common.delete': 'Eliminar',
  'common.save': 'Guardar',
  'common.cancel': 'Cancelar',
  'common.close': 'Cerrar',
  'common.direct': 'Directo',
  'common.directNone': 'Directo/Ninguno',
  'common.unknown': 'Desconocido',
  'common.none': '(ninguno)',
  'common.ago': 'hace {time}',

  // Sites
  'sites.addWebsite': 'Agregar un sitio web',
  'sites.addWebsiteBtn': '+ Agregar sitio',
  'sites.logOut': 'Cerrar sesión',
  'sites.yourWebsites': 'Tus sitios web',
  'sites.visitors24h': 'visitantes en las últimas 24h',
  'sites.online': '{n} en línea',
  'sites.empty': 'Aún no hay sitios. Agrega el primero para obtener tu código de rastreo.',
  'sites.domain': 'Dominio',
  'sites.domainPlaceholder': 'ejemplo.com',
  'sites.subdomainsNote': 'Los subdominios (app.ejemplo.com) se rastrean bajo el mismo sitio.',
  'sites.name': 'Nombre',
  'sites.namePlaceholder': 'Mi SaaS',
  'sites.timezone': 'Zona horaria',
  'sites.currency': 'Moneda de ingresos',
  'sites.addWebsiteSubmit': 'Agregar sitio',
  'sites.signOut': 'Cerrar sesión',

  // Common (extra)
  'common.clearAll': 'Limpiar todo',
  'common.removeFilter': 'Quitar filtro',
  'common.visitors': 'Visitantes',
  'common.revenue': 'Ingresos',
  'common.pageviews': 'Páginas vistas',
  'common.customers': 'Clientes',
  'common.conversion': 'Conversión',
  'common.rotate': 'Rotar',
  'common.search': 'Buscar…',

  // Dashboard
  'dashboard.siteNotFound': 'Sitio no encontrado.',
  'dashboard.backToWebsites': 'Volver a los sitios',
  'dashboard.filterIs': 'es',
  'dashboard.timesIn': 'Horas en {tz}',
  'dashboard.revenueIn': 'Ingresos en {currency}',
  'dashboard.settingsInstall': 'Configuración e instalación',
  // Dashboard — filter dimension labels
  'dashboard.filter.channel': 'Canal',
  'dashboard.filter.source': 'Referente',
  'dashboard.filter.utm_campaign': 'Campaña',
  'dashboard.filter.utm_term': 'Palabra clave',
  'dashboard.filter.utm_source': 'Fuente UTM',
  'dashboard.filter.utm_medium': 'Medio UTM',
  'dashboard.filter.ref': 'Ref',
  'dashboard.filter.country': 'País',
  'dashboard.filter.region': 'Región',
  'dashboard.filter.city': 'Ciudad',
  'dashboard.filter.browser': 'Navegador',
  'dashboard.filter.os': 'Sistema operativo',
  'dashboard.filter.device': 'Dispositivo',
  'dashboard.filter.page': 'Página visitada',
  'dashboard.filter.entry_page': 'Página de entrada',
  'dashboard.filter.hostname': 'Host',
  'dashboard.filter.goal': 'Objetivo completado',

  // Panel — tab labels
  'panel.tab.channel': 'Canal',
  'panel.tab.source': 'Referente',
  'panel.tab.campaign': 'Campaña',
  'panel.tab.keyword': 'Palabra clave',
  'panel.tab.country': 'País',
  'panel.tab.region': 'Región',
  'panel.tab.city': 'Ciudad',
  'panel.tab.page': 'Página',
  'panel.tab.entry_page': 'Página de entrada',
  'panel.tab.exit_link': 'Enlace de salida',
  'panel.tab.hostname': 'Host',
  'panel.tab.browser': 'Navegador',
  'panel.tab.os': 'Sistema operativo',
  'panel.tab.device': 'Dispositivo',
  // Panel — controls & table
  'panel.sortHint': 'Ordenar por visitantes o ingresos',
  'panel.noData': 'Sin datos para este periodo',
  'panel.details': '⛶ Detalles',
  'panel.clickToFilter': 'Clic para filtrar',
  'panel.revPerVisitor': 'Ingreso/visitante',
  'panel.convShort': 'Conv.',

  // Overview
  'overview.online': 'En línea',
  'overview.showHide': 'Mostrar/ocultar en la gráfica',
  'overview.revenuePerVisitor': 'Ingreso/visitante',

  // Goals panel — tabs
  'goals.tab.goals': 'Objetivos',
  'goals.tab.funnel': 'Embudo',
  'goals.tab.users': 'Usuarios',
  'goals.tab.journey': 'Recorrido',
  'goals.search': '🔍 Buscar',
  // Goals tab
  'goals.empty.prefix': 'Aún no hay objetivos. Agrega',
  'goals.empty.middle': 'a cualquier botón, o llama',
  'goals.empty.suffix': '.',
  'goals.col.goal': 'Objetivo',
  'goals.col.completions': 'Completados',
  'goals.filterByGoal': 'Filtrar por visitantes que completaron este objetivo',
  // Funnels
  'goals.funnel.newFunnel': '+ Nuevo embudo',
  'goals.funnel.deleteConfirm': '¿Eliminar el embudo "{name}"?',
  'goals.funnel.visitorsDot': '{n} visitantes',
  'goals.funnel.dropoff': '−{pct} de abandono',
  'goals.funnel.stepsHelp': 'Los pasos se cuentan en orden por visitante. Las rutas de página admiten comodines como {wildcard}.',
  'goals.funnel.defaultName': 'Embudo de registro',
  'goals.funnel.namePlaceholder': 'Nombre del embudo',
  'goals.funnel.typePage': 'Página',
  'goals.funnel.typeGoal': 'Objetivo',
  'goals.funnel.pagePlaceholder': '/precios',
  'goals.funnel.goalPlaceholder': 'registro',
  'goals.funnel.addStep': '+ Paso',
  'goals.funnel.save': 'Guardar embudo',
  // Journey
  'goals.journey.empty': 'No hay pagos en este periodo. Conecta Dodo Payments en la configuración del sitio para ver quién pagó y de dónde llegó.',
  'goals.journey.unmatched': '{n} pago aún no vinculado a un visitante.',
  'goals.journey.unmatchedPlural': '{n} pagos aún no vinculados a un visitante.',
  'goals.journey.why': '¿Por qué?',
  'goals.journey.matching': 'Vinculando…',
  'goals.journey.matched': 'Vinculados {matched} de {checked}',
  'goals.journey.tryMatch': 'Intentar vincular de nuevo',
  'goals.journey.matchedYes': '✓ vinculado',
  'goals.journey.matchedNo': '✗ sin vincular',
  'goals.journey.col.visitor': 'Visitante',
  'goals.journey.col.source': 'Fuente',
  'goals.journey.col.spent': 'Gastado',
  'goals.journey.col.timeToComplete': 'Tiempo para completar',
  'goals.journey.col.completedAt': 'Completado el',
  'goals.journey.matchedBy': 'vinculado por {reason}',
  'goals.journey.matchedByHint': 'Cómo se vinculó este pago con el visitante',
  'goals.journey.notAttributed': 'Sin atribuir',
  'goals.journey.notAttributedHint': 'No hay id de visitante en los metadatos del pago, ni coincidencia por página de retorno, correo o tiempo',
  'goals.journey.badge.returning': 'Recurrente',
  'goals.journey.badge.customer': 'Cliente',
  'goals.journey.visit': '{n} visita',
  'goals.journey.visits': '{n} visitas',
  // Match reasons
  'goals.match.return_page': 'página de retorno',
  'goals.match.customer': 'pago anterior',
  'goals.match.email': 'correo',
  'goals.match.timing': 'momento del clic en checkout',
  // Users
  'goals.users.empty': 'No hay visitantes en este periodo.',
  'goals.users.col.visits': 'Visitas',
  'goals.users.col.pages': 'Páginas',
  'goals.users.col.time': 'Tiempo',
  'goals.users.col.lastSeen': 'Última vez',
  'goals.users.badge.customer': 'Cliente',
  'goals.showAll': 'Ver todos ({total})',
  'goals.visitorFallback': 'Visitante {id}',

  // Visitor modal
  'visitor.profile': 'Perfil del visitante',
  'visitor.fallback': 'Visitante {id}',
  'visitor.stat.firstSource': 'Primera fuente',
  'visitor.stat.visits': 'Visitas',
  'visitor.stat.totalSpent': 'Total gastado',
  'visitor.stat.timeToFirstPayment': 'Tiempo hasta el primer pago',
  'visitor.campaign': 'campaña: {value}',
  'visitor.ref': 'ref: {value}',
  'visitor.goalOn': 'en {path}',
  'visitor.leftTo': 'Salió hacia {target}',
  'visitor.refund': 'Reembolso',
  'visitor.paid': 'Pagó',
  'visitor.payment': 'Pago',
  'visitor.renewal': 'Renovación',
  'visitor.payments': 'Pagos',

  // Settings
  'settings.backDashboard': '← Panel',
  'settings.s1.title': '1. Instala el script de rastreo',
  'settings.s1.descPre': 'Pega esto en el',
  'settings.s1.descPost': 'de cada página de {domain} (y sus subdominios).',
  'settings.s1.nextjsExample': 'Ejemplo con Next.js / React',
  'settings.s1.beatAdblockers': 'Evita los bloqueadores de anuncios (recomendado para mayor precisión)',
  'settings.s1.beatAdblockersDesc': 'Los bloqueadores de anuncios pueden bloquear dominios de analíticas de terceros. Sirve el script y el endpoint desde tu propio dominio con un rewrite, y luego apunta el script ahí:',
  'settings.s1.excludePre': 'Excluye tus propias visitas: abre',
  'settings.s1.excludePost': 'una vez en cada navegador que uses.',
  'settings.s2.title': '2. Rastrea clics en botones y objetivos',
  'settings.s2.desc': 'Los objetivos aparecen en la pestaña Objetivos y se pueden usar en embudos y filtros.',
  'settings.s2.outbound': 'Los clics en enlaces salientes se rastrean automáticamente (pestaña Enlace de salida).',
  'settings.s3.title': '3. Conecta Dodo Payments (atribución de ingresos)',
  'settings.s3.desc': 'Los pagos se vinculan con el visitante que pagó y se acreditan a la fuente que lo trajo.',
  'settings.s3.step1Pre': 'En Dodo Payments →',
  'settings.s3.step1DevWebhooks': 'Developer → Webhooks',
  'settings.s3.step1Mid': ', agrega este endpoint y suscríbete a',
  'settings.s3.step1And': 'y',
  'settings.s3.step1End': ':',
  'settings.s3.step2Pre': 'Pega el',
  'settings.s3.step2SigningSecret': 'secreto de firma',
  'settings.s3.step2Mid': 'del webhook (empieza con',
  'settings.s3.step2End': '):',
  'settings.s3.secretPlaceholder': 'whsec_...',
  'settings.s3.secretSaved': 'Secreto del webhook guardado',
  'settings.s3.secretConfigured': '✓ Secreto configurado',
  'settings.s3.step3': 'Pasa las cookies del visitante como metadatos al crear un checkout (esto es lo que hace que la atribución sea exacta):',
  'settings.s3.step3NotePre': '¿Usas',
  'settings.s3.step3NotePaymentLinks': 'payment links',
  'settings.s3.step3NoteMid': 'de Dodo (checkout.dodopayments.com/buy/…) en su lugar? El script agrega los metadatos a esos enlaces automáticamente al hacer clic, pero no siempre llegan al pago, así que configura también la URL de retorno (paso 4). En el navegador también puedes leer los ids con',
  'settings.s3.step3NoteEnd': '.',
  'settings.s3.step3Note2': 'Si faltan los metadatos, Minilytics igual vincula el pago cuando el comprador regresa a tu sitio, cuando su correo coincide con un visitante que hayas usado en {identify}, cuando es una renovación de un pago anterior, o cuando exactamente un visitante hizo clic en un enlace de checkout poco antes de pagar. La pestaña Recorrido muestra cómo se vinculó cada pago.',
  'settings.s3.step4Recommended': 'Recomendado:',
  'settings.s3.step4Mid': 'configura la',
  'settings.s3.step4ReturnUrl': 'URL de retorno / redirección',
  'settings.s3.step4End': 'de tu producto en Dodo a una página de tu sitio, p. ej. {url}. Dodo le agrega {param}, lo que permite a Minilytics vincular el pago con el visitante exacto incluso cuando los metadatos no llegan (por ejemplo con payment links).',
  'settings.api.title': 'Otros proveedores de pago / API del lado del servidor',
  'settings.api.desc': 'Envía pagos u objetivos desde tu backend usando la clave de API de este sitio.',
  'settings.api.rotateConfirm': '¿Rotar la clave de API? La clave anterior deja de funcionar de inmediato.',
  'settings.general.title': 'General',
  'settings.general.name': 'Nombre',
  'settings.general.domain': 'Dominio',
  'settings.general.timezone': 'Zona horaria',
  'settings.general.currency': 'Moneda de ingresos',
  'settings.general.saveChanges': 'Guardar cambios',
  'settings.saved': 'Guardado',
  'settings.danger.title': 'Zona de peligro',
  'settings.danger.delete': 'Eliminar el sitio y todos los datos',
  'settings.danger.deleteConfirm': 'Escribe {domain} para eliminar este sitio y todos sus datos',
  'settings.ai.title': '✨ Configurar con IA',
  'settings.ai.desc': 'Copia este prompt en Claude Code, Cursor o cualquier IA de código abierta en tu proyecto. Instala el script, conecta la atribución de Dodo Payments, identifica usuarios y agrega objetivos a los botones, usando los valores reales de este sitio. Solo te pregunta lo que no puede encontrar en tu código.',
  'settings.ai.copy': 'Copiar prompt de IA',
  'settings.ai.copied': '✓ Copiado',
  'settings.ai.hidePrompt': 'Ocultar prompt',
  'settings.ai.previewPrompt': 'Vista previa del prompt',
  'settings.ai.note': 'La IA se encarga del código. El webhook de Dodo lo conectas tú (paso 3 abajo), porque eso se hace en el panel de Dodo.',
  'settings.link.title': 'Generador de enlaces',
  'settings.link.desc': 'X, Medium y otros ocultan qué publicación exacta envió a un visitante. Usa un enlace etiquetado en cada publicación y aparecerá por nombre en Referente → Campaña, incluyendo los ingresos que generó.',
  'settings.link.page': 'Página',
  'settings.link.whereYouPost': 'Dónde lo publicas',
  'settings.link.postName': 'Nombre de la publicación (campaña)',
  'settings.link.postNamePlaceholder': 'tweet-lanzamiento, articulo-guia-seo…',
  'settings.link.shorterPre': 'Alternativa más corta:',
  'settings.link.shorterPost': 'también funciona y aparece como el referente.',
};

const dictionaries: Record<Lang, Dict> = { en, es };

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    // localStorage may be unavailable (private mode); fall through.
  }
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es')) return 'es';
  return 'en';
}

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const l = detectLang();
    setFormatLocale(l); // keep Intl formatting (dates, numbers, money) in sync from the first render
    return l;
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    setFormatLocale(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore persistence failure
    }
  }, []);

  const t = useCallback<TFn>(
    (key, vars) => {
      let s = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
      if (vars) for (const k in vars) s = s.replace(`{${k}}`, String(vars[k]));
      return s;
    },
    [lang],
  );

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

/** Convenience hook when a component only needs the translator. */
export function useT(): TFn {
  return useI18n().t;
}
