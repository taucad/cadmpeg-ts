import { jsdocQualityRule } from './jsdoc-quality.js';

export const plugin = {
  meta: { name: 'cadmpeg-ts', version: '1.0.0' },
  rules: { 'jsdoc-quality': jsdocQualityRule },
};
