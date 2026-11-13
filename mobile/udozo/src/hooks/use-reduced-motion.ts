import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Whether the phone asks for reduced motion (true until it has said, so nothing moves before it answers). */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      value => alive && setReduced(value),
      () => alive && setReduced(false),
    );
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      listener.remove();
    };
  }, []);
  return reduced;
}
