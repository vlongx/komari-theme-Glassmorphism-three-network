<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { onMounted, ref } from 'vue'

interface VisitorData {
  ip: string
  city: string
  region: string
  country: string
  org: string
}

const show = ref(false)
const dismissed = ref(false)
const visitor = ref<VisitorData | null>(null)

const windowsPattern = /Windows/i
const macPattern = /Mac/i
const androidPattern = /Android/i
const iosPattern = /iPhone|iPad/i
const edgPattern = /Edg/i
const chromePattern = /Chrome/i
const firefoxPattern = /Firefox/i
const safariPattern = /Safari/i
const macOsPattern = /Mac OS X/i
const linuxPattern = /Linux/i

onMounted(async () => {
  try {
    const res = await fetch('https://ipapi.co/json/')
    const data = await res.json()
    visitor.value = {
      ip: data.ip,
      city: data.city,
      region: data.region,
      country: data.country_name,
      org: data.org,
    }
  }
  catch {
    visitor.value = null
  }
  finally {
    setTimeout(() => {
      show.value = true
    }, 600)
  }
})

function dismiss() {
  dismissed.value = true
}

function getOsIcon(): string {
  const ua = navigator.userAgent
  if (windowsPattern.test(ua))
    return 'icon-park-outline:windows'
  if (macPattern.test(ua))
    return 'icon-park-outline:mac'
  if (androidPattern.test(ua))
    return 'icon-park-outline:android'
  if (iosPattern.test(ua))
    return 'icon-park-outline:apple'
  return 'icon-park-outline:laptop'
}

function getBrowserName(): string {
  const ua = navigator.userAgent
  if (edgPattern.test(ua))
    return 'Edge Browser'
  if (chromePattern.test(ua))
    return 'Chrome Browser'
  if (firefoxPattern.test(ua))
    return 'Firefox Browser'
  if (safariPattern.test(ua))
    return 'Safari Browser'
  return 'Unknown Browser'
}

function getOsName(): string {
  const ua = navigator.userAgent
  if (windowsPattern.test(ua))
    return 'Windows'
  if (macOsPattern.test(ua))
    return 'macOS'
  if (androidPattern.test(ua))
    return 'Android'
  if (iosPattern.test(ua))
    return 'iOS'
  if (linuxPattern.test(ua))
    return 'Linux'
  return 'Unknown OS'
}

function formatDate(): string {
  return new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// 站点名（访客卡片头部显示用）
const siteName = '访客'
</script>

<template>
  <!-- 底部居中 IP 条（桌面+手机都显示） -->
  <Transition name="slide-up">
    <div
      v-if="show && !dismissed && visitor"
      class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50
             flex items-center gap-2 px-4 py-1.5 rounded-full
             bg-white/55 dark:bg-black/50
             backdrop-blur-md
             border border-white/40 dark:border-white/10
             shadow-lg text-[13px] select-none whitespace-nowrap"
    >
      <Icon icon="icon-park-outline:earth" :width="14" :height="14" class="text-blue-500 shrink-0" />
      <span class="text-muted-foreground">Your IP:</span>
      <span class="font-semibold text-foreground">{{ visitor.ip }}</span>
      <span class="text-muted-foreground/40">|</span>
      <span class="text-muted-foreground">{{ visitor.country }}</span>
      <span class="text-muted-foreground/40">|</span>
      <span class="text-muted-foreground truncate max-w-[140px] md:max-w-[220px]">{{ visitor.org }}</span>
    </div>
  </Transition>

  <!-- 左下角详情卡片 — 模仿图二样式 -->
  <Transition name="slide-left">
    <div
      v-if="show && !dismissed && visitor"
      class="fixed bottom-16 left-3 z-50 w-56 rounded-2xl overflow-hidden
             bg-white/70 dark:bg-neutral-900/70
             backdrop-blur-xl
             border border-white/40 dark:border-white/10
             shadow-2xl"
    >
      <!-- 顶部：头像 + 名字 + 关闭 -->
      <div class="flex items-center justify-between px-4 pt-4 pb-1">
        <div class="flex items-center gap-2.5">
          <!-- 渐变头像圆 -->
          <div class="size-9 rounded-full bg-gradient-to-br from-violet-400 via-blue-400 to-cyan-400 flex items-center justify-center shrink-0 shadow-md">
            <Icon icon="icon-park-outline:user" :width="18" :height="18" class="text-white" />
          </div>
          <div class="flex flex-col leading-tight">
            <span class="text-[14px] font-bold text-violet-500 dark:text-violet-400">{{ siteName }}</span>
            <span class="text-[11px] text-muted-foreground">{{ visitor.city }}, {{ visitor.region }}</span>
          </div>
        </div>
        <button
          class="size-6 rounded-full flex items-center justify-center
                 hover:bg-black/8 dark:hover:bg-white/10 transition-colors"
          @click="dismiss"
        >
          <Icon icon="icon-park-outline:close" :width="13" :height="13" class="text-muted-foreground" />
        </button>
      </div>

      <!-- Welcome 文字 -->
      <div class="px-4 pb-2">
        <p class="text-[12px] text-foreground/70">
          Welcome from {{ visitor.city }}!
        </p>
      </div>

      <!-- 分割线 -->
      <div class="mx-4 border-t border-black/6 dark:border-white/8 mb-2" />

      <!-- 信息行 -->
      <div class="px-4 pb-4 flex flex-col gap-2">
        <div class="flex items-center gap-2.5 text-[12px] text-foreground/75">
          <Icon :icon="getOsIcon()" :width="14" :height="14" class="text-muted-foreground shrink-0" />
          <span>{{ getOsName() }}</span>
        </div>
        <div class="flex items-center gap-2.5 text-[12px] text-foreground/75">
          <Icon icon="icon-park-outline:browser-chrome" :width="14" :height="14" class="text-muted-foreground shrink-0" />
          <span>{{ getBrowserName() }}</span>
        </div>
        <div class="flex items-center gap-2.5 text-[12px] text-foreground/75">
          <Icon icon="icon-park-outline:local" :width="14" :height="14" class="text-blue-500 shrink-0" />
          <span class="font-mono truncate">{{ visitor.ip }}</span>
        </div>
        <div class="flex items-center gap-2.5 text-[12px] text-foreground/75">
          <Icon icon="icon-park-outline:protect" :width="14" :height="14" class="text-muted-foreground shrink-0" />
          <span class="truncate">{{ visitor.org }}</span>
        </div>
        <div class="flex items-center gap-2.5 text-[12px] text-foreground/75">
          <Icon icon="icon-park-outline:time" :width="14" :height="14" class="text-muted-foreground shrink-0" />
          <span>{{ formatDate() }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}

.slide-left-enter-active,
.slide-left-leave-active {
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.slide-left-enter-from,
.slide-left-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}
</style>
