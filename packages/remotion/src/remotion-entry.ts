/**
 * Remotion Entry Point
 *
 * This file is the entry point for bundling the Remotion project for Lambda.
 * It must be a separate file that only handles registration.
 */
import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
