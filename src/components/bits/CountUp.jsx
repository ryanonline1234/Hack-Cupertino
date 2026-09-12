/*
 * CountUp — vendored from React Bits (MIT, github.com/DavidHDev/react-bits,
 * TextAnimations/CountUp), adapted: `motion/react` import swapped for the
 * framer-motion v12 already in this repo (same hooks), plus a
 * prefers-reduced-motion guard that renders the final value with no motion.
 *
 * Spring-driven number tween that starts when scrolled into view. Used for
 * KPI figures (stat rows, experiment results) so data arrivals read as
 * events, not swaps.
 */
import { useInView, useMotionValue, useSpring } from 'framer-motion';
import { useCallback, useEffect, useRef } from 'react';

const REDUCE_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function CountUp({
  to,
  from = 0,
  direction = 'up',
  delay = 0,
  duration = 1.2,
  className = '',
  startWhen = true,
  separator = '',
  prefix = '',
  suffix = '',
  // Explicit decimal places. When omitted, derived from `to` — which is
  // wrong for computed floats (0.2124… would render 16 decimals), so
  // callers displaying formatted figures must pass this.
  decimals = null,
  onStart,
  onEnd,
}) {
  const ref = useRef(null);
  const motionValue = useMotionValue(direction === 'down' ? to : from);

  const damping = 20 + 40 * (1 / duration);
  const stiffness = 100 * (1 / duration);

  const springValue = useSpring(motionValue, { damping, stiffness });
  const isInView = useInView(ref, { once: true, margin: '0px' });

  const getDecimalPlaces = (num) => {
    const str = num.toString();
    if (str.includes('.')) {
      const decimals = str.split('.')[1];
      if (parseInt(decimals) !== 0) return decimals.length;
    }
    return 0;
  };

  const maxDecimals = Number.isInteger(decimals) && decimals >= 0
    ? decimals
    : Math.max(getDecimalPlaces(from), getDecimalPlaces(to));

  const formatValue = useCallback(
    (latest) => {
      const hasDecimals = maxDecimals > 0;
      const options = {
        useGrouping: !!separator,
        minimumFractionDigits: hasDecimals ? maxDecimals : 0,
        maximumFractionDigits: hasDecimals ? maxDecimals : 0,
      };
      const formattedNumber = Intl.NumberFormat('en-US', options).format(latest);
      const grouped = separator ? formattedNumber.replace(/,/g, separator) : formattedNumber;
      return `${prefix}${grouped}${suffix}`;
    },
    [maxDecimals, separator, prefix, suffix],
  );

  useEffect(() => {
    if (ref.current) {
      ref.current.textContent = formatValue(direction === 'down' ? to : from);
    }
  }, [from, to, direction, formatValue]);

  useEffect(() => {
    // Reduced motion: jump straight to the final value, no spring.
    if (REDUCE_MOTION) {
      motionValue.set(direction === 'down' ? from : to);
      return undefined;
    }
    if (isInView && startWhen) {
      if (typeof onStart === 'function') onStart();
      const timeoutId = setTimeout(() => {
        motionValue.set(direction === 'down' ? from : to);
      }, delay * 1000);
      const durationTimeoutId = setTimeout(
        () => {
          if (typeof onEnd === 'function') onEnd();
        },
        delay * 1000 + duration * 1000,
      );
      return () => {
        clearTimeout(timeoutId);
        clearTimeout(durationTimeoutId);
      };
    }
    return undefined;
  }, [isInView, startWhen, motionValue, direction, from, to, delay, onStart, onEnd, duration]);

  useEffect(() => {
    const unsubscribe = springValue.on('change', (latest) => {
      if (ref.current) {
        ref.current.textContent = formatValue(latest);
      }
    });
    return () => unsubscribe();
  }, [springValue, formatValue]);

  return <span className={className} ref={ref} />;
}
