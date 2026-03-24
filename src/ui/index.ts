/**
 * NeuroBase UI Module
 * Rich terminal interface components
 */

export { colors, box, icons, spinnerFrames, termWidth, separator, labeledSeparator } from './theme';
export { showBanner, showConnectionInfo, showQuickHelp } from './banner';
export {
  renderSQL,
  renderResultTable,
  renderResultMeta,
  renderError,
  renderSuccess,
  renderInfo,
  renderWarning,
  renderConversation,
  renderClarification,
  renderSchemaOverview,
  renderStats,
  renderHelp,
} from './render';
export { NeuroSpinner, renderPipeline } from './spinner';
export { runSetupWizard } from './setup-wizard';
