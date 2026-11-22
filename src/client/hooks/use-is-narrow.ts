import { useEffect, useState } from 'react';

export function useIsNarrow(maxWidth = 980) {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth <= maxWidth);
  useEffect(() => {
    const update = () => setNarrow(window.innerWidth <= maxWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [maxWidth]);
  return narrow;
}
