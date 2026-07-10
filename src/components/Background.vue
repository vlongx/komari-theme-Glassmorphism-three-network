<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()

const isLoaded = ref(false)
const hasError = ref(false)

const showBackground = computed(() => appStore.backgroundEnabled)
const currentUrl = computed(() => showBackground.value ? appStore.currentBackgroundUrl : '')
const backgroundType = computed(() => appStore.backgroundType)
const hasCustomBackground = computed(() => showBackground.value && !!currentUrl.value)
const showBackgroundOverlay = computed(() => appStore.backgroundOverlay > 0)

const backgroundStyle = computed(() => {
  const blur = appStore.backgroundBlur
  return {
    filter: blur > 0 ? `blur(${blur}px)` : 'none',
    opacity: appStore.backgroundType === 'video' && !isLoaded.value ? 0 : 1,
  }
})

const backgroundContainerStyle = computed(() => {
  const overlay = appStore.backgroundOverlay
  if (overlay >= 0)
    return {}

  return { opacity: 1 - Math.abs(overlay) / 100 }
})

const overlayStyle = computed(() => {
  const overlay = appStore.backgroundOverlay
  if (overlay <= 0)
    return {}

  return { backgroundColor: `rgba(0, 0, 0, ${overlay / 100})` }
})

const showLoadedBackground = computed(() =>
  hasCustomBackground.value && isLoaded.value && !hasError.value,
)

const showMediaBackground = computed(() =>
  hasCustomBackground.value && !hasError.value && (backgroundType.value === 'video' || showLoadedBackground.value),
)

const showDefaultBackground = computed(() => !hasCustomBackground.value)

const showLoadingBackground = computed(() =>
  hasCustomBackground.value && !isLoaded.value && !hasError.value,
)

const showFallbackBackground = computed(() =>
  hasCustomBackground.value && hasError.value,
)

let imageLoader: HTMLImageElement | null = null

function clearImageLoader() {
  if (imageLoader) {
    imageLoader.onload = null
    imageLoader.onerror = null
    imageLoader = null
  }
}

function loadImage(url: string) {
  isLoaded.value = false
  hasError.value = false

  clearImageLoader()

  imageLoader = new Image()
  imageLoader.onload = () => {
    isLoaded.value = true
    hasError.value = false
  }
  imageLoader.onerror = () => {
    isLoaded.value = false
    hasError.value = true
  }
  imageLoader.src = url
}

const videoRef = ref<HTMLVideoElement | null>(null)

function resetBackgroundState() {
  clearImageLoader()

  if (videoRef.value) {
    videoRef.value.pause()
    videoRef.value.removeAttribute('src')
    videoRef.value.load()
  }

  isLoaded.value = false
  hasError.value = false
}

function handleVideoLoaded() {
  isLoaded.value = true
  hasError.value = false
}
function handleVideoError() {
  isLoaded.value = false
  hasError.value = true
}

watch([showBackground, currentUrl, backgroundType], ([enabled, url, type]) => {
  if (!enabled || !url) {
    resetBackgroundState()
    return
  }

  if (type === 'image') {
    loadImage(url)
  }
  else if (type === 'video') {
    clearImageLoader()
    isLoaded.value = false
    hasError.value = false
  }
}, { immediate: true })

onUnmounted(() => {
  resetBackgroundState()
})
</script>

<template>
  <div class="background-container" :style="backgroundContainerStyle">
    <Transition name="fade">
      <div v-if="showDefaultBackground" class="default-background">
        <div class="default-background__spotlight">
          <div class="default-background__emerald-surface">
            <svg
              aria-hidden="true"
              class="default-background__pattern"
            >
              <defs>
                <pattern id="glassmorphism-emerald-grid" width="72" height="56" patternUnits="userSpaceOnUse" x="-12" y="4">
                  <path d="M.5 56V.5H72" fill="none" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" stroke-width="0" fill="url(#glassmorphism-emerald-grid)" />
              <svg x="-12" y="4" class="default-background__pattern-blocks">
                <rect stroke-width="0" width="73" height="57" x="288" y="168" />
                <rect stroke-width="0" width="73" height="57" x="144" y="56" />
                <rect stroke-width="0" width="73" height="57" x="504" y="168" />
                <rect stroke-width="0" width="73" height="57" x="720" y="336" />
              </svg>
            </svg>
          </div>
        </div>
      </div>
    </Transition>
    <Transition name="fade">
      <div v-if="showLoadingBackground" class="background-loading" />
    </Transition>
    <Transition name="fade">
      <div v-if="showFallbackBackground" class="background-loading" />
    </Transition>
    <Transition name="fade">
      <div v-if="showMediaBackground" class="background-media" :style="backgroundStyle">
        <div
          v-if="backgroundType === 'image'"
          class="background-image"
          :style="{ backgroundImage: `url(${currentUrl})` }"
        />
        <video
          v-else-if="backgroundType === 'video'"
          ref="videoRef"
          class="background-video"
          :src="currentUrl ?? undefined"
          autoplay
          loop
          muted
          preload="auto"
          playsinline
          @loadeddata="handleVideoLoaded"
          @canplay="handleVideoLoaded"
          @error="handleVideoError"
        />
      </div>
    </Transition>
    <div v-if="showBackgroundOverlay" class="background-overlay" :style="overlayStyle" />
  </div>
</template>

<style scoped>
.background-container {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
}

.default-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: rgb(248 250 252);
  transform: scale(1.5);
  transform-origin: top center;
}

.dark .default-background {
  background: rgb(15 23 42 / 0.5);
}

.default-background__spotlight,
.default-background__emerald-surface,
.default-background__pattern,
.default-background__pattern-blocks {
  position: absolute;
}

.default-background__spotlight {
  top: 0;
  left: 50%;
  width: 81.25rem;
  height: 25rem;
  margin-left: -38rem;
  pointer-events: none;
}

.dark .default-background__spotlight {
  -webkit-mask-image: linear-gradient(white, transparent);
  mask-image: linear-gradient(white, transparent);
}

.default-background__emerald-surface {
  inset: 0;
  overflow: hidden;
  background: linear-gradient(90deg, rgb(16 185 129 / 0.4), rgb(190 242 100 / 0.4));
  opacity: 0.4;
  -webkit-mask-image: radial-gradient(farthest-side at top, white, transparent);
  mask-image: radial-gradient(farthest-side at top, white, transparent);
}

.dark .default-background__emerald-surface {
  background: linear-gradient(90deg, rgb(16 185 129 / 0.3), rgb(190 242 100 / 0.3));
  opacity: 1;
}

.default-background__pattern {
  inset-inline: 0;
  top: -50%;
  width: 100%;
  height: 200%;
  fill: rgb(0 0 0 / 0.4);
  stroke: rgb(0 0 0 / 0.5);
  mix-blend-mode: overlay;
  transform: skewY(-18deg);
}

.dark .default-background__pattern {
  fill: rgb(255 255 255 / 0.025);
  stroke: rgb(255 255 255 / 0.05);
}

.default-background__pattern-blocks {
  overflow: visible;
}

@media (max-width: 768px) {
  .default-background {
    transform: scale(1.25);
  }

  .default-background__spotlight {
    left: 50%;
    width: 60rem;
    height: 22rem;
    margin-left: -30rem;
  }
}

.background-loading {
  position: absolute;
  inset: 0;
  background-color: var(--background);
}

.background-media {
  position: absolute;
  inset: 0;
  transition: opacity 0.8s ease;
}

.background-image {
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

.background-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.background-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.8s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
