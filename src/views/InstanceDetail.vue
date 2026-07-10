<script setup lang="ts">
import type { NodeData } from '@/stores/nodes'
import type { CurrencyCode } from '@/utils/financeHelper'
import type { IpGeo } from '@/utils/ipGeoHelper'
import type { ProviderResolveResult } from '@/utils/providerInfo'
import { Icon } from '@iconify/vue'
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardX } from '@/components/ui/card-x'
import { DataTooltip } from '@/components/ui/data-tooltip'
import { Empty } from '@/components/ui/empty'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAppStore } from '@/stores/app'
import { useNodesStore } from '@/stores/nodes'
import { getSharedApi } from '@/utils/api'
import { formatCityNameZh } from '@/utils/cityNameHelper'
import * as financeHelper from '@/utils/financeHelper'
import { formatBytesPerSecondWithConfig, formatBytesWithConfig, formatUptimeWithFormat } from '@/utils/helper'
import { lookupIpGeo } from '@/utils/ipGeoHelper'
import { getOSImage, getOSName } from '@/utils/osImageHelper'
import { resolveProviderInfo } from '@/utils/providerInfo'
import { getRegionCode, getRegionDisplayName } from '@/utils/regionHelper'
import { getSharedRpc } from '@/utils/rpc'

import { formatPrice, formatPriceWithCycle, getExpireStatus, getExpireText, parseTags } from '@/utils/tagHelper'

const LoadChart = defineAsyncComponent(() => import('@/components/LoadChart.vue'))
const PingChart = defineAsyncComponent(() => import('@/components/PingChart.vue'))

const route = useRoute()
const router = useRouter()

const appStore = useAppStore()
const nodesStore = useNodesStore()
const exchangeRates = ref(financeHelper.DEFAULT_EXCHANGE_RATES)
const financeCurrency = ref<CurrencyCode>('CNY')

// VPS 厂商识别
const vpsProvider = ref<ProviderResolveResult | null>(null)
// IP 解析结果（城市 / ASN 组织 / AS 号）
const nodeGeo = ref<IpGeo | null>(null)
// 近一天网速峰值（B/s）
const peakNetOut = ref(0)
const peakNetIn = ref(0)
const activeDetailSection = ref<'overview' | 'load' | 'ping'>('overview')
const data = computed(() => nodesStore.visibleNodesByUuid.get(String(route.params.id)))

// CPU 评分
interface CpuScore {
  score: number
  tier: 'S' | 'A' | 'B' | 'C' | 'D'
  tierColor: string
  label: string
}

// 基于 CPU 型号关键字静态估算 PassMark 分数区间
function estimateCpuScore(cpuName: string): CpuScore {
  if (!cpuName || cpuName === '-')
    return { score: 0, tier: 'D', tierColor: 'text-gray-400', label: '未知' }

  const name = cpuName.toLowerCase()

  // AMD EPYC 系列
  if (name.includes('epyc 9') || name.includes('epyc 75') || name.includes('epyc 74'))
    return { score: 95, tier: 'S', tierColor: 'text-yellow-500', label: '旗舰服务器级' }
  if (name.includes('epyc 7'))
    return { score: 82, tier: 'A', tierColor: 'text-blue-500', label: '高端服务器级' }
  if (name.includes('epyc'))
    return { score: 72, tier: 'A', tierColor: 'text-blue-500', label: '服务器级' }

  // Intel Xeon 系列
  if (name.includes('xeon gold 6') || name.includes('xeon platinum'))
    return { score: 80, tier: 'A', tierColor: 'text-blue-500', label: '高端服务器级' }
  if (name.includes('xeon gold'))
    return { score: 68, tier: 'B', tierColor: 'text-green-500', label: '服务器级' }
  if (name.includes('xeon silver') || name.includes('xeon e5') || name.includes('xeon e-'))
    return { score: 55, tier: 'B', tierColor: 'text-green-500', label: '中端服务器级' }
  if (name.includes('xeon'))
    return { score: 45, tier: 'C', tierColor: 'text-orange-500', label: '入门服务器级' }

  // AMD Ryzen 系列
  if (name.includes('ryzen 9 7') || name.includes('ryzen 9 9'))
    return { score: 92, tier: 'S', tierColor: 'text-yellow-500', label: '旗舰消费级' }
  if (name.includes('ryzen 9'))
    return { score: 80, tier: 'A', tierColor: 'text-blue-500', label: '高端消费级' }
  if (name.includes('ryzen 7'))
    return { score: 70, tier: 'A', tierColor: 'text-blue-500', label: '中高端消费级' }
  if (name.includes('ryzen 5'))
    return { score: 58, tier: 'B', tierColor: 'text-green-500', label: '中端消费级' }
  if (name.includes('ryzen 3'))
    return { score: 42, tier: 'C', tierColor: 'text-orange-500', label: '入门消费级' }

  // Intel Core 系列
  if (name.includes('core i9') || name.includes('core ultra 9'))
    return { score: 88, tier: 'S', tierColor: 'text-yellow-500', label: '旗舰消费级' }
  if (name.includes('core i7') || name.includes('core ultra 7'))
    return { score: 72, tier: 'A', tierColor: 'text-blue-500', label: '高端消费级' }
  if (name.includes('core i5') || name.includes('core ultra 5'))
    return { score: 60, tier: 'B', tierColor: 'text-green-500', label: '中端消费级' }
  if (name.includes('core i3'))
    return { score: 42, tier: 'C', tierColor: 'text-orange-500', label: '入门消费级' }

  // ARM / Ampere
  if (name.includes('ampere') || name.includes('altra'))
    return { score: 78, tier: 'A', tierColor: 'text-blue-500', label: '云原生 ARM 级' }
  if (name.includes('neoverse') || name.includes('graviton'))
    return { score: 70, tier: 'A', tierColor: 'text-blue-500', label: '云原生 ARM 级' }
  if (name.includes('arm') || name.includes('aarch64'))
    return { score: 40, tier: 'C', tierColor: 'text-orange-500', label: 'ARM 级' }

  // 虚拟化通用
  if (name.includes('virtual') || name.includes('kvm64') || name.includes('qemu'))
    return { score: 30, tier: 'D', tierColor: 'text-red-400', label: '虚拟化通用' }

  return { score: 35, tier: 'C', tierColor: 'text-orange-500', label: '通用' }
}

let providerResolveSeq = 0
let trafficPeakSeq = 0

async function lookupNodeGeo(node: NodeData): Promise<IpGeo | null> {
  const ips = [node.ipv4, node.ipv6].filter((ip): ip is string => Boolean(ip?.trim()))
  for (const ip of ips) {
    const geo = await lookupIpGeo(ip)
    if (geo)
      return geo
  }
  return null
}

// 优先使用用户元数据识别实际商家，再回退到 ASN / org 网络信息。
async function resolveProvider(node: NodeData): Promise<void> {
  const seq = ++providerResolveSeq
  const uuid = node.uuid
  nodeGeo.value = null
  vpsProvider.value = null

  const metadata = [node.name, node.public_remark, node.remark, node.tags, node.group, node.region]
    .filter(Boolean)
    .join(' ')
  const geo = await lookupNodeGeo(node)

  if (seq !== providerResolveSeq || data.value?.uuid !== uuid)
    return

  nodeGeo.value = geo
  vpsProvider.value = resolveProviderInfo({
    metadata,
    org: geo?.org,
    asn: geo?.asn,
    customAliases: appStore.providerAliases,
  })
}

async function loadTrafficPeakRecords(uuid: string): Promise<Array<{ net_in?: number, net_out?: number }>> {
  try {
    const { records } = await getSharedRpc().getLoadRecords(uuid, 24)
    if (records.length > 0)
      return records
  }
  catch {
    // RPC 历史记录在部分 Komari 版本或传输模式下可能不可用，继续回退 REST。
  }

  try {
    const { records } = await getSharedApi().getLoadRecords(uuid, 24)
    return records
  }
  catch {
    return []
  }
}

// 拉取近一天负载记录，统计网速峰值（上/下行各自取最大瞬时值）
async function fetchTrafficPeak(uuid: string): Promise<void> {
  const seq = ++trafficPeakSeq
  peakNetOut.value = 0
  peakNetIn.value = 0

  const records = await loadTrafficPeakRecords(uuid)
  if (seq !== trafficPeakSeq || data.value?.uuid !== uuid)
    return

  let up = 0
  let down = 0
  for (const r of records) {
    if (typeof r.net_out === 'number' && r.net_out > up)
      up = r.net_out
    if (typeof r.net_in === 'number' && r.net_in > down)
      down = r.net_in
  }
  peakNetOut.value = up
  peakNetIn.value = down
}

onMounted(async () => {
  window.scrollTo({ top: 0, behavior: 'instant' })
  financeCurrency.value = financeHelper.getStoredFinanceCurrency()
  const { rates } = await financeHelper.getDailyExchangeRates()
  exchangeRates.value = rates
})

// 当节点数据加载后尝试获取厂商信息
// 注：节点 IP 通常不直接暴露，这里用节点 uuid 作为 fallback 标识
// 如果 data.value 有 ip 字段则直接用，否则跳过
watch(data, (node) => {
  activeDetailSection.value = 'overview'
  if (node) {
    void resolveProvider(node)
    void fetchTrafficPeak(node.uuid)
  }
}, { immediate: true })

const cpuScore = computed(() => estimateCpuScore(data.value?.cpu_name ?? ''))

// 机房/厂商展示：城市 · 厂商 · ASN（缺项自动省略）
const providerDisplay = computed(() => {
  const parts: string[] = []
  const cityName = formatCityNameZh(nodeGeo.value?.city)
  if (cityName)
    parts.push(cityName)
  if (vpsProvider.value?.displayName)
    parts.push(vpsProvider.value.displayName)
  if (nodeGeo.value?.asn)
    parts.push(nodeGeo.value.asn)
  return parts.length ? parts.join(' · ') : '-'
})

// 节点自定义标签
const customTags = computed(() => parseTags(data.value?.tags).map(t => t.text))

// 该节点支持的 IP 协议（仅显示"支持"，不暴露具体 IP）
const ipSupport = computed(() => {
  const node = data.value
  const arr: string[] = []
  if (node?.ipv4)
    arr.push('IPv4')
  if (node?.ipv6)
    arr.push('IPv6')
  return arr
})

const hasPeak = computed(() => peakNetOut.value > 0 || peakNetIn.value > 0)

// 未登录且开启「未登录隐藏价格」时，屏蔽金额类指标（剩余时间为天数，仍显示）
const showPrice = computed(() => appStore.isLoggedIn || !appStore.hidePriceWhenLoggedOut)

const formatBytes = (bytes: number) => formatBytesWithConfig(bytes, appStore.byteDecimals)
const formatBytesPerSecond = (bytes: number) => formatBytesPerSecondWithConfig(bytes, appStore.byteDecimals)
const formatUptime = (seconds: number) => formatUptimeWithFormat(seconds, 'minute')
const getRegionAltText = (region: string) => getRegionDisplayName(region) || getRegionCode(region)

interface InfoItem {
  label: string
  value: string | undefined
  icon?: string
}

interface MetricCard {
  label: string
  value: string
  unit?: string
  icon: string
  valueClass?: string
}

const MONTH_DAYS = 30
const EXPIRES_IN_SUFFIX_REGEX = /^(\d+)\s*(天|days?)$/i
const CURRENCY_SUFFIX_REGEX = /^(\S.*\S)\s+([A-Z]{3})$/

function formatNodeAmount(amount: number, currency: string): string {
  if (!Number.isFinite(amount) || amount <= 0)
    return formatPrice(0, currency, appStore.lang)
  const fractionDigits = Math.abs(amount) >= 100 ? 0 : 2
  const normalizedAmount = Number(amount.toFixed(fractionDigits))
  return formatPrice(normalizedAmount, currency, appStore.lang)
}

function calculateMonthlyAverageCost(price: number, billingCycle: number): number | null {
  const normalizedPrice = Number(price)
  const normalizedCycle = Number(billingCycle)
  if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0)
    return 0
  if (!Number.isFinite(normalizedCycle) || normalizedCycle <= 0)
    return null
  return normalizedPrice / normalizedCycle * MONTH_DAYS
}

function splitMetricValue(value: string): { value: string, unit?: string } {
  const cycleIndex = value.indexOf(' / ')
  if (cycleIndex > -1)
    return { value: value.slice(0, cycleIndex), unit: value.slice(cycleIndex) }
  const expiresInMatch = value.match(EXPIRES_IN_SUFFIX_REGEX)
  if (expiresInMatch)
    return { value: expiresInMatch[1] ?? value, unit: expiresInMatch[2] ?? undefined }
  const currencyMatch = value.match(CURRENCY_SUFFIX_REGEX)
  if (currencyMatch)
    return { value: currencyMatch[1] ?? value, unit: currencyMatch[2] ?? undefined }
  return { value }
}

const nodePriceText = computed(() => {
  if (!data.value)
    return '-'
  if (Number(data.value.price) <= 0)
    return formatPrice(0, data.value.currency, appStore.lang)
  return formatPriceWithCycle(data.value.price, data.value.billing_cycle, data.value.currency, appStore.lang)
})

const monthlyAverageCostText = computed(() => {
  if (!data.value)
    return '-'
  const monthlyAverageCost = calculateMonthlyAverageCost(data.value.price, data.value.billing_cycle)
  if (monthlyAverageCost === null)
    return appStore.lang === 'zh-CN' ? '不适用' : 'N/A'
  return `${formatNodeAmount(monthlyAverageCost, data.value.currency)} / 月`
})

const remainingTimeText = computed(() => {
  if (!data.value?.expired_at)
    return '-'
  return getExpireText(data.value.expired_at, appStore.lang)
})

const remainingValueText = computed(() => {
  if (!data.value)
    return '-'
  const remainingValueCNY = financeHelper.calculateRemainingValueCNY(data.value, exchangeRates.value)
  const targetRate = exchangeRates.value[financeCurrency.value] || 1
  const formattedValue = financeHelper.formatFinanceAmount(remainingValueCNY * targetRate, financeCurrency.value)
  return `${formattedValue.symbol}${formattedValue.value}`
})

const remainingTimeValueClass = computed(() => {
  if (!data.value?.expired_at)
    return ''
  const status = getExpireStatus(data.value.expired_at)
  if (status === 'expired' || status === 'critical')
    return 'text-destructive'
  if (status === 'warning')
    return 'text-orange-600 dark:text-orange-400'
  if (status === 'long_term')
    return 'text-muted-foreground'
  return 'text-emerald-600 dark:text-emerald-400'
})

const metricCards = computed<MetricCard[]>(() => {
  if (!data.value)
    return []
  const masked = !showPrice.value
  const nodePrice = splitMetricValue(nodePriceText.value)
  const monthlyAverageCost = splitMetricValue(monthlyAverageCostText.value)
  const remainingTime = splitMetricValue(remainingTimeText.value)
  const remainingValue = splitMetricValue(remainingValueText.value)
  return [
    { label: '节点价格', value: masked ? '***' : nodePrice.value, unit: masked ? undefined : nodePrice.unit, icon: 'tabler:cash' },
    { label: '月均支出', value: masked ? '***' : monthlyAverageCost.value, unit: masked ? undefined : monthlyAverageCost.unit, icon: 'tabler:receipt-2' },
    { label: '剩余时间', value: remainingTime.value, unit: remainingTime.unit, icon: 'tabler:calendar-dollar', valueClass: remainingTimeValueClass.value },
    { label: '剩余价值', value: masked ? '***' : remainingValue.value, unit: masked ? undefined : remainingValue.unit, icon: 'tabler:coins' },
  ]
})

// 硬件信息小卡：CPU 单独全宽展示，这里是其余小格。
// - 「架构」格：登录后改显节点 IP（避免未登录访客扫到 IP），未登录或无 IP 时回退显示架构
// - GPU：仅在节点确实有 GPU 时才显示
const hardwareSmallItems = computed<InfoItem[]>(() => {
  const node = data.value
  const items: InfoItem[] = []

  const ip = node?.ipv4 || node?.ipv6
  if (appStore.isLoggedIn && ip)
    items.push({ label: 'IP', value: ip, icon: 'tabler:world' })
  else
    items.push({ label: '架构', value: node?.arch ?? '-', icon: 'icon-park-outline:application-two' })

  items.push({ label: '虚拟化', value: node?.virtualization ?? '-', icon: 'icon-park-outline:server' })

  const gpu = node?.gpu_name?.trim()
  if (gpu && gpu.toLowerCase() !== 'none')
    items.push({ label: 'GPU', value: gpu, icon: 'icon-park-outline:video-one' })

  return items
})

const systemInfo = computed<InfoItem[]>(() => [
  { label: '操作系统', value: data.value?.os ?? '-', icon: 'icon-park-outline:computer' },
  { label: '内核版本', value: data.value?.kernel_version ?? '-', icon: 'icon-park-outline:code' },
  { label: '运行时间', value: formatUptime(data.value?.uptime ?? 0), icon: 'icon-park-outline:timer' },
  { label: '厂商', value: providerDisplay.value, icon: vpsProvider.value?.primary.icon ?? 'icon-park-outline:server' },
])

const storageInfo = computed<InfoItem[]>(() => [
  { label: '内存', value: formatBytes(data.value?.mem_total ?? 0), icon: 'icon-park-outline:memory' },
  { label: '内存交换', value: formatBytes(data.value?.swap_total ?? 0), icon: 'icon-park-outline:switch' },
  { label: '硬盘', value: formatBytes(data.value?.disk_total ?? 0), icon: 'icon-park-outline:hard-disk' },
])

const trafficUsed = computed(() => {
  const node = data.value
  if (!node)
    return 0
  const { net_total_up = 0, net_total_down = 0, traffic_limit_type } = node
  switch (traffic_limit_type) {
    case 'up': return net_total_up
    case 'down': return net_total_down
    case 'min': return Math.min(net_total_up, net_total_down)
    case 'max': return Math.max(net_total_up, net_total_down)
    case 'sum':
    default: return net_total_up + net_total_down
  }
})

const hasTrafficLimit = computed(() => (data.value?.traffic_limit ?? 0) > 0)

const trafficUsedPercentage = computed(() => {
  const trafficLimit = data.value?.traffic_limit ?? 0
  if (trafficLimit <= 0)
    return 0
  return Math.min((trafficUsed.value / trafficLimit) * 100, 100)
})

const trafficUsageText = computed(() => {
  if (!hasTrafficLimit.value)
    return '无限流量'
  return `${formatBytes(trafficUsed.value)} / ${formatBytes(data.value?.traffic_limit ?? 0)}`
})

const trafficProgressStyle = computed(() => ({
  width: `${trafficUsedPercentage.value}%`,
}))

// 总流量进度条按使用率分级着色：≥80% 红、60-80% 琥珀、<60% 绿
const trafficProgressClass = computed(() => {
  const p = trafficUsedPercentage.value
  if (p >= 80)
    return 'bg-red-500/30'
  if (p >= 60)
    return 'bg-amber-500/25'
  return 'bg-emerald-500/20'
})
</script>

<template>
  <div class="instance-detail space-y-4">
    <div v-if="!data" class="p-4">
      <CardX>
        <Empty description="节点不存在或已被删除">
          <template #extra>
            <Button @click="router.push('/')">
              返回首页
            </Button>
          </template>
        </Empty>
      </CardX>
    </div>

    <template v-else>
      <!-- 顶部导航 -->
      <div class="px-4 flex gap-4 items-center">
        <Button variant="ghost" size="icon-sm" class="bg-background/50 hover:bg-background" aria-label="返回首页" @click="router.push('/')">
          <Icon icon="tabler:arrow-left" :width="16" :height="16" />
        </Button>
        <div class="text-lg font-bold flex gap-2 items-center">
          <img :src="`/images/flags/${getRegionCode(data.region)}.svg`" :alt="getRegionAltText(data.region)" class="size-6">
          <span>{{ data.name }}</span>
        </div>
        <Badge :variant="data.online ? 'default' : 'destructive'" class="text-xs !rounded">
          {{ data.online ? '在线' : '离线' }}
        </Badge>
        <!-- 节点自定义标签 -->
        <div v-if="customTags.length" class="flex flex-wrap gap-1">
          <Badge
            v-for="(tag, i) in customTags" :key="i" variant="outline"
            class="!text-[11px] rounded text-muted-foreground border-muted-foreground/15 px-1.5 py-0"
          >
            {{ tag }}
          </Badge>
        </div>
        <!-- 厂商标识 -->
        <DataTooltip
          v-if="vpsProvider"
          as="div"
          placement="bottom"
          :content="vpsProvider.tooltipLines.join('\n')"
          class="ml-auto max-w-full"
          content-class="w-72 whitespace-pre-wrap break-words px-2 py-1.5 text-left leading-relaxed"
        >
          <div class="flex max-w-full items-center gap-1.5 rounded-full bg-background/50 px-3 py-1 text-xs text-muted-foreground">
            <Icon :icon="vpsProvider.primary.icon" :width="14" :height="14" class="shrink-0" />
            <span class="whitespace-normal break-words leading-snug">{{ vpsProvider.displayName }}</span>
          </div>
        </DataTooltip>
      </div>

      <div v-if="appStore.nodeDetailSectionTabsEnabled" class="px-4 overflow-x-auto">
        <Tabs v-model="activeDetailSection" class="w-full">
          <TabsList class="w-max h-8 bg-background/50 backdrop-blur-xl rounded-md">
            <TabsTrigger value="overview" class="h-6.5 flex-none shrink-0 gap-1 text-xs border-none data-[state=active]:text-green-600 shadow-none rounded-sm">
              <Icon icon="tabler:layout-dashboard" :width="12" :height="12" />
              概览
            </TabsTrigger>
            <TabsTrigger value="load" class="h-6.5 flex-none shrink-0 gap-1 text-xs border-none data-[state=active]:text-green-600 shadow-none rounded-sm">
              <Icon icon="tabler:activity" :width="12" :height="12" />
              负载
            </TabsTrigger>
            <TabsTrigger value="ping" class="h-6.5 flex-none shrink-0 gap-1 text-xs border-none data-[state=active]:text-green-600 shadow-none rounded-sm">
              <Icon icon="tabler:timeline" :width="12" :height="12" />
              延迟
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <!-- 价格指标卡片 -->
      <div v-if="!appStore.nodeDetailSectionTabsEnabled || activeDetailSection === 'overview'" class="px-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <CardX
          v-for="item in metricCards" :key="item.label" hoverable size="small"
          class="group h-full bg-background/50 border-none hover:bg-background transition-all rounded-md"
          content-class="h-full !p-3"
        >
          <div class="flex h-full min-h-10 md:min-h-18 flex-col justify-between gap-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-medium tracking-wider text-muted-foreground">{{ item.label }}</span>
              <Icon :icon="item.icon" :width="20" :height="20" class="text-slate-500/25 transition-colors group-hover:text-slate-500" />
            </div>
            <div class="min-w-0 space-y-1">
              <div class="flex min-w-0 items-baseline gap-1 truncate font-semibold leading-none" :class="item.valueClass">
                <span class="truncate text-base sm:text-2xl">{{ item.value }}</span>
                <span v-if="item.unit" class="shrink-0 text-[11px] font-medium text-muted-foreground sm:text-xs">{{ item.unit }}</span>
              </div>
            </div>
          </div>
        </CardX>
      </div>

      <!-- 硬件信息 + CPU 评分 -->
      <div v-if="!appStore.nodeDetailSectionTabsEnabled || activeDetailSection === 'overview'" class="px-4 gap-4 grid grid-cols-1 lg:grid-cols-2">
        <CardX
          title="硬件信息" size="small" content-class="flex-1"
          class="group h-full bg-background/50 border-none hover:bg-background transition-all rounded-md"
        >
          <div class="flex flex-col gap-3 h-full">
            <!-- CPU 信息 + 评分（跨全宽） -->
            <div class="min-w-0 flex flex-col gap-2 rounded-sm bg-slate-500/5 p-2">
              <div class="flex gap-1 items-center text-muted-foreground">
                <Icon icon="icon-park-outline:cpu" :width="14" :height="14" />
                <span class="text-xs sm:text-sm">CPU</span>
              </div>
              <span class="text-xs sm:text-sm break-all">{{ data.cpu_name }} (x{{ data.cpu_cores }})</span>
              <!-- 评分条 -->
              <div class="flex items-center gap-2 mt-1">
                <span class="text-xs font-bold" :class="cpuScore.tierColor">{{ cpuScore.tier }}</span>
                <div class="flex-1 h-1.5 rounded-full bg-slate-500/10 overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all duration-700"
                    :class="{
                      'bg-yellow-500': cpuScore.tier === 'S',
                      'bg-blue-500': cpuScore.tier === 'A',
                      'bg-green-500': cpuScore.tier === 'B',
                      'bg-orange-500': cpuScore.tier === 'C',
                      'bg-red-400': cpuScore.tier === 'D',
                    }"
                    :style="{ width: `${cpuScore.score}%` }"
                  />
                </div>
                <span class="text-[11px] text-muted-foreground shrink-0">{{ cpuScore.label }}</span>
              </div>
            </div>

            <!-- IP/架构 · 虚拟化 · GPU(仅在存在时)，列数随数量自适应避免留空，整体撑满高度 -->
            <div class="grid gap-3 flex-1 auto-rows-fr" :class="hardwareSmallItems.length <= 2 ? 'grid-cols-2' : 'grid-cols-3'">
              <div
                v-for="item in hardwareSmallItems" :key="item.label"
                class="min-w-0 flex flex-col gap-1 rounded-sm bg-slate-500/5 p-2"
              >
                <div class="flex gap-1 items-center text-muted-foreground">
                  <Icon v-if="item.icon" :icon="item.icon" :width="14" :height="14" />
                  <span class="text-xs sm:text-sm">{{ item.label }}</span>
                </div>
                <span class="text-xs sm:text-sm break-words">{{ item.value }}</span>
              </div>
            </div>
          </div>
        </CardX>

        <CardX
          title="系统信息" size="small" content-class="flex-1"
          class="group h-full bg-background/50 border-none hover:bg-background transition-all rounded-md"
        >
          <div class="gap-3 grid grid-cols-1 sm:grid-cols-2 h-full sm:auto-rows-fr">
            <div
              v-for="item in systemInfo" :key="item.label"
              class="min-w-0 flex flex-col gap-1 rounded-sm bg-slate-500/5 p-2"
            >
              <div class="flex gap-1 items-center text-muted-foreground">
                <Icon v-if="item.icon" :icon="item.icon" :width="14" :height="14" />
                <span class="text-xs sm:text-sm">{{ item.label }}</span>
              </div>
              <div class="flex min-w-0 gap-2 items-center">
                <img v-if="item.label === '操作系统'" :src="getOSImage(data.os)" :alt="getOSName(data.os)" class="size-5 shrink-0">
                <span class="text-xs sm:text-sm break-words">{{ item.value }}</span>
              </div>
            </div>
          </div>
        </CardX>

        <CardX
          title="存储信息" size="small"
          class="group h-full bg-background/50 border-none hover:bg-background transition-all rounded-md"
        >
          <div class="gap-3 grid grid-cols-3">
            <div
              v-for="item in storageInfo" :key="item.label"
              class="min-w-0 flex flex-col gap-1 rounded-sm bg-slate-500/5 p-2"
            >
              <div class="flex gap-1 items-center text-muted-foreground">
                <Icon v-if="item.icon" :icon="item.icon" :width="14" :height="14" />
                <span class="text-xs sm:text-sm">{{ item.label }}</span>
              </div>
              <span class="text-xs sm:text-sm break-words">{{ item.value }}</span>
            </div>
          </div>
        </CardX>

        <CardX
          title="网络信息" size="small"
          class="group h-full bg-background/50 border-none hover:bg-background transition-all rounded-md"
          content-class="pt-0"
        >
          <div class="gap-3 grid grid-cols-2">
            <div class="relative min-w-0 overflow-hidden rounded-sm bg-slate-500/5 p-2">
              <div
                v-if="hasTrafficLimit"
                class="absolute inset-y-0 left-0 rounded-sm pointer-events-none transition-[width,background-color] duration-300 ease-out"
                :class="trafficProgressClass"
                :style="trafficProgressStyle"
              />
              <div class="relative flex flex-col gap-1.5">
                <div class="flex gap-1 items-center text-muted-foreground">
                  <Icon icon="icon-park-outline:transfer-data" :width="14" :height="14" />
                  <span class="text-xs sm:text-sm">总流量</span>
                  <Badge
                    v-for="proto in ipSupport" :key="proto" variant="outline"
                    class="!text-[10px] rounded text-emerald-600 border-emerald-600/25 px-1 py-0 leading-none"
                  >
                    {{ proto }}
                  </Badge>
                  <div class="flex-1" />
                  <span class="hidden sm:block text-[11px] font-medium text-foreground/70">
                    {{ formatBytes(data?.net_total_up ?? 0) }} / {{ formatBytes(data?.net_total_down ?? 0) }}
                  </span>
                </div>
                <span class="text-xs sm:text-sm break-all">{{ trafficUsageText }}</span>
                <span v-if="hasPeak" class="text-[10px] text-muted-foreground/80 flex items-center gap-2 leading-none">
                  <span>近一天峰值</span>
                  <span class="text-green-600 flex items-center gap-0.5">
                    <Icon icon="tabler:chevron-up" width="10" height="10" />{{ formatBytesPerSecond(peakNetOut) }}
                  </span>
                  <span class="text-blue-600 flex items-center gap-0.5">
                    <Icon icon="tabler:chevron-down" width="10" height="10" />{{ formatBytesPerSecond(peakNetIn) }}
                  </span>
                </span>
              </div>
            </div>
            <div class="min-w-0 flex flex-col gap-1 rounded-sm bg-slate-500/5 p-2">
              <div class="flex gap-1 items-center text-muted-foreground">
                <Icon icon="icon-park-outline:dashboard-one" :width="14" :height="14" />
                <span class="text-xs sm:text-sm">网络速率</span>
              </div>
              <span class="text-xs sm:text-sm break-all flex flex-row flex-wrap items-center gap-1">
                <Icon icon="tabler:chevron-up" width="12" height="12" />
                {{ formatBytesPerSecond(data?.net_out ?? 0) }}
                <span class="px-0.5" />
                <Icon icon="tabler:chevron-down" width="12" height="12" />
                {{ formatBytesPerSecond(data?.net_in ?? 0) }}
              </span>
            </div>
          </div>
        </CardX>
      </div>

      <LoadChart v-if="!appStore.nodeDetailSectionTabsEnabled || activeDetailSection === 'load'" :uuid="data.uuid" class="px-4" />
      <PingChart v-if="!appStore.nodeDetailSectionTabsEnabled || activeDetailSection === 'ping'" :uuid="data.uuid" class="px-4" />
    </template>
  </div>
</template>
