import { useEffect, useRef } from 'react'
import { Animated, ViewStyle } from 'react-native'

export function useFadeInAnimation(shouldAnimate = true) {
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (shouldAnimate) {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start()
    }
  }, [opacity, shouldAnimate])

  return { opacity }
}

export function useSlideInAnimation(shouldAnimate = true) {
  const translateY = useRef(new Animated.Value(20)).current
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (shouldAnimate) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start()
    }
  }, [translateY, opacity, shouldAnimate])

  return { transform: [{ translateY }], opacity }
}

export function useScaleInAnimation(shouldAnimate = true) {
  const scale = useRef(new Animated.Value(0.9)).current
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (shouldAnimate) {
      Animated.parallel([
        Animated.timing(scale, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start()
    }
  }, [scale, opacity, shouldAnimate])

  return { transform: [{ scale }], opacity }
}

export function usePulseAnimation() {
  const scale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.05, duration: 1000, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    )
    animation.start()
    return () => animation.stop()
  }, [scale])

  return { transform: [{ scale }] }
}

export const AnimationPresets = {
  slideFromBottom: {
    transform: [{ translateY: 20 }],
    opacity: 0,
  },
  scaleSmall: {
    transform: [{ scale: 0.9 }],
    opacity: 0,
  },
  fadeIn: {
    opacity: 0,
  },
}
