import type { CheckInput, CheckResult } from '../types';
import { result } from './common';

export const FACE_LABEL = 'Gesicht';

/** Genau ein Gesicht muss erkannt sein. */
export function checkFace(input: CheckInput): CheckResult {
  const target = 'genau 1 Gesicht';
  if (input.faceCount === 0 || !input.landmarks) {
    return result('face', FACE_LABEL, 'fail', 0, 'keines erkannt', target, 'Kein Gesicht erkannt – Kamera auf das Gesicht richten');
  }
  if (input.faceCount > 1) {
    return result('face', FACE_LABEL, 'fail', 0, `${input.faceCount} erkannt`, target, 'Es darf nur eine Person im Bild sein');
  }
  return result('face', FACE_LABEL, 'ok', 1, '1 erkannt', target, '');
}
