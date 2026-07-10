import type { MaybeRefOrGetter } from 'vue'
import { useThrottleFn } from '@vueuse/core'
import { computed, onScopeDispose, ref, shallowRef, toValue, watch } from 'vue'
import { getSharedRpc } from '@/utils/rpc'

export interface NodePingHistoryPoint {
  time: string
  latency: number | null
  loss: number | null
}

export interface NodePingStatsState {
  avgLatency: number
  avgLoss: number
  avgVolatility: number
  history: NodePingHistoryPoint[]
  hasData: boolean
}

interface PingRecord {
  client: string
  task_id: number
  time: string
  value: number
}

export interface PingTaskInfo {
  id: number
  name: string
  interval?: number
  loss?: number
}

interface SharedPingRecordsResponse {
  records?: PingRecord[]
  tasks?: PingTaskInfo[]
}

interface SharedPingRecordsState {
  recordsByClient: Map<string, PingRecord[]>
  tasks: PingTaskInfo[]
}

interface SharedPingRecordsEntry {
  data: ReturnType<typeof shallowRef<SharedPingRecordsState | null>>
  loading: ReturnType<typeof ref<boolean>>
  error: ReturnType<typeof ref<string | null>>
  promise: Promise<void> | null
  refreshTimer: ReturnType<typeof setInterval> | null
  subscribers: number
  lastFetchedAt: number
}

const HISTORY_BUCKET_COUNT = 20
const CACHE_VERSION = 5
const CACHE_KEY_PREFIX = 'komari-theme-emerald:node-ping-stats'
const FULL_LOSS_EPSILON = 1e-6
const PING_RECORD_REFRESH_INTERVAL_MS = 60_000
const sharedPingRecordsCache = new Map<number, SharedPingRecordsEntry>()

interface TaskRecordSummary {
  total: number
  success: number
}

function createEmptyStats(): NodePingStatsState {
  return {
    avgLatency: 0,
    avgLoss: 0,
    avgVolatility: 0,
    history: [],
    hasData: false,
  }
}

function average(values: number[]): number {
  if (!values.length)
    return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function summarizeTaskRecords(records: PingRecord[]): Map<number, TaskRecordSummary> {
  const summaries = new Map<number, TaskRecordSummary>()

  for (const record of records) {
    const summary = summaries.get(record.task_id) ?? { total: 0, success: 0 }
    summary.total += 1
    if (record.value >= 0) {
      summary.success += 1
    }
    summaries.set(record.task_id, summary)
  }

  return summaries
}

function getIncludedTaskIds(records: PingRecord[]): Set<number> {
  const recordSummaries = summarizeTaskRecords(records)

  return new Set(
    [...recordSummaries.entries()]
      .filter(([, summary]) => summary.total > 0 && summary.success > 0)
      .map(([taskId]) => taskId),
  )
}

function getCacheKey(uuid: string, hours: number): string {
  return `${CACHE_KEY_PREFIX}:${uuid}:${hours}`
}

function isValidHistoryPoint(value: unknown): value is NodePingHistoryPoint {
  if (!value || typeof value !== 'object')
    return false

  const point = value as Record<string, unknown>
  const latency = point.latency
  const loss = point.loss

  return typeof point.time === 'string'
    && (latency === null || typeof latency === 'number')
    && (loss === null || typeof loss === 'number')
}

function isValidStatsState(value: unknown): value is NodePingStatsState {
  if (!value || typeof value !== 'object')
    return false

  const state = value as Record<string, unknown>
  return typeof state.avgLatency === 'number'
    && typeof state.avgLoss === 'number'
    && typeof state.avgVolatility === 'number'
    && typeof state.hasData === 'boolean'
    && Array.isArray(state.history)
    && state.history.every(isValidHistoryPoint)
}

function readStatsCache(uuid: string, hours: number): NodePingStatsState | null {
  if (typeof window === 'undefined')
    return null

  try {
    const raw = window.localStorage.getItem(getCacheKey(uuid, hours))
    if (!raw)
      return null

    const parsed = JSON.parse(raw) as { version?: number, stats?: unknown }
    if (parsed.version !== CACHE_VERSION || !isValidStatsState(parsed.stats))
      return null

    return parsed.stats
  }
  catch {
    return null
  }
}

function writeStatsCache(uuid: string, hours: number, value: NodePingStatsState): void {
  if (typeof window === 'undefined')
    return

  try {
    window.localStorage.setItem(
      getCacheKey(uuid, hours),
      JSON.stringify({
        version: CACHE_VERSION,
        updatedAt: new Date().toISOString(),
        stats: value,
      }),
    )
  }
  catch {
  }
}

function createSharedPingRecordsEntry(): SharedPingRecordsEntry {
  return {
    data: shallowRef<SharedPingRecordsState | null>(null),
    loading: ref(false),
    error: ref<string | null>(null),
    promise: null,
    refreshTimer: null,
    subscribers: 0,
    lastFetchedAt: 0,
  }
}

function getSharedPingRecordsEntry(hours: number): SharedPingRecordsEntry {
  const cachedEntry = sharedPingRecordsCache.get(hours)
  if (cachedEntry)
    return cachedEntry

  const nextEntry = createSharedPingRecordsEntry()
  sharedPingRecordsCache.set(hours, nextEntry)
  return nextEntry
}

function buildRecordsByClient(records: PingRecord[]): Map<string, PingRecord[]> {
  const grouped = new Map<string, PingRecord[]>()

  for (const record of records) {
    if (!record.client)
      continue

    const clientRecords = grouped.get(record.client) ?? []
    clientRecords.push(record)
    grouped.set(record.client, clientRecords)
  }

  for (const clientRecords of grouped.values()) {
    clientRecords.sort(
      (left, right) => new Date(left.time).getTime() - new Date(right.time).getTime(),
    )
  }

  return grouped
}

async function loadSharedPingRecords(entry: SharedPingRecordsEntry, hours: number): Promise<void> {
  if (entry.promise)
    return entry.promise

  const rpc = getSharedRpc()
  entry.loading.value = true
  entry.error.value = null

  entry.promise = (async () => {
    try {
      const result = await rpc.getClient().call<SharedPingRecordsResponse>('common:getRecords', {
        type: 'ping',
        hours,
      })

      entry.data.value = {
        recordsByClient: buildRecordsByClient(result?.records ?? []),
        tasks: (result?.tasks ?? []).filter(task => Number.isFinite(task.id) && typeof task.name === 'string'),
      }
      entry.lastFetchedAt = Date.now()
    }
    catch (err) {
      entry.error.value = err instanceof Error ? err.message : '获取 Ping 历史失败'
      throw err
    }
    finally {
      entry.loading.value = false
      entry.promise = null
    }
  })()

  return entry.promise
}

function startSharedPingRecordsRefresh(entry: SharedPingRecordsEntry, hours: number): void {
  if (entry.refreshTimer)
    return

  entry.refreshTimer = setInterval(() => {
    void loadSharedPingRecords(entry, hours).catch(() => {})
  }, PING_RECORD_REFRESH_INTERVAL_MS)
}

function stopSharedPingRecordsRefresh(entry: SharedPingRecordsEntry): void {
  if (!entry.refreshTimer)
    return

  clearInterval(entry.refreshTimer)
  entry.refreshTimer = null
}

function retainSharedPingRecordsEntry(hours: number): () => void {
  const entry = getSharedPingRecordsEntry(hours)
  entry.subscribers += 1
  startSharedPingRecordsRefresh(entry, hours)

  let released = false
  return () => {
    if (released)
      return

    released = true
    entry.subscribers = Math.max(0, entry.subscribers - 1)
    if (entry.subscribers === 0)
      stopSharedPingRecordsRefresh(entry)
  }
}

function buildPingHistory(records: PingRecord[]): NodePingHistoryPoint[] {
  const sortedRecords = records
    .map((record) => {
      const timestamp = new Date(record.time).getTime()
      return { ...record, timestamp }
    })
    .filter(record => Number.isFinite(record.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp)

  if (!sortedRecords.length)
    return []

  const firstTime = sortedRecords[0]?.timestamp ?? 0
  const lastTime = sortedRecords.at(-1)?.timestamp ?? firstTime
  const bucketCount = Math.min(HISTORY_BUCKET_COUNT, sortedRecords.length)
  const bucketSize = Math.max(1, (lastTime - firstTime) / bucketCount)

  const history: NodePingHistoryPoint[] = []
  let recordIndex = 0

  for (let index = 0; index < bucketCount; index++) {
    const startTime = firstTime + bucketSize * index
    const endTime = index === bucketCount - 1 ? lastTime + 1 : startTime + bucketSize
    let totalCount = 0
    let lostCount = 0
    let latencySum = 0
    let latencyCount = 0

    while (recordIndex < sortedRecords.length) {
      const record = sortedRecords[recordIndex]
      if (!record || record.timestamp >= endTime)
        break

      if (record.timestamp >= startTime) {
        totalCount += 1
        if (record.value >= 0) {
          latencySum += record.value
          latencyCount += 1
        }
        else {
          lostCount += 1
        }
      }
      recordIndex += 1
    }

    history.push({
      time: new Date(startTime).toISOString(),
      latency: latencyCount ? latencySum / latencyCount : null,
      loss: totalCount ? lostCount / totalCount * 100 : null,
    })
  }

  return history
}

function getPercentile(values: number[], percentile: number): number | null {
  if (!values.length)
    return null

  const sorted = [...values].sort((left, right) => left - right)
  const position = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * percentile))
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lowerValue = sorted[lowerIndex]
  const upperValue = sorted[upperIndex]

  if (lowerValue === undefined || upperValue === undefined)
    return null
  if (lowerIndex === upperIndex)
    return lowerValue

  return lowerValue + (upperValue - lowerValue) * (position - lowerIndex)
}

function buildStats(records: PingRecord[]): NodePingStatsState {
  const includedTaskIds = getIncludedTaskIds(records)

  if (!includedTaskIds.size)
    return createEmptyStats()

  const filteredRecords = records.filter(record => includedTaskIds.has(record.task_id))
  const history = buildPingHistory(filteredRecords)
  const taskRecords = new Map<number, PingRecord[]>()

  for (const record of filteredRecords) {
    const currentRecords = taskRecords.get(record.task_id) ?? []
    currentRecords.push(record)
    taskRecords.set(record.task_id, currentRecords)
  }

  const latencyValues: number[] = []
  const taskLossValues: number[] = []
  const volatilityValues: number[] = []

  for (const recordsByTask of taskRecords.values()) {
    const validValues = recordsByTask
      .map(record => record.value)
      .filter(value => value >= 0)

    if (!validValues.length)
      continue

    latencyValues.push(average(validValues))
    taskLossValues.push((recordsByTask.length - validValues.length) / recordsByTask.length * 100)

    if (validValues.length > 1) {
      const p50 = getPercentile(validValues, 0.5)
      const p99 = getPercentile(validValues, 0.99)
      if (isFiniteNumber(p50) && isFiniteNumber(p99) && p50 > FULL_LOSS_EPSILON) {
        volatilityValues.push(p99 / p50)
      }
    }
  }

  const historyLatencyValues = history
    .map(point => point.latency)
    .filter(isFiniteNumber)
  const historyLossValues = history
    .map(point => point.loss)
    .filter(isFiniteNumber)

  const avgLatency = latencyValues.length ? average(latencyValues) : average(historyLatencyValues)
  const avgLoss = taskLossValues.length ? average(taskLossValues) : average(historyLossValues)
  const avgVolatility = average(volatilityValues)
  const hasData = history.length > 0 || latencyValues.length > 0 || taskLossValues.length > 0

  return {
    avgLatency,
    avgLoss,
    avgVolatility,
    history,
    hasData,
  }
}

export function useNodePingStats(
  uuid: MaybeRefOrGetter<string>,
  options?: {
    hours?: MaybeRefOrGetter<number>
    enabled?: MaybeRefOrGetter<boolean>
  },
) {
  const loading = ref(false)
  const error = ref<string | null>(null)

  const resolved = computed(() => ({
    uuid: toValue(uuid),
    hours: Math.max(1, Math.floor(toValue(options?.hours) ?? 24)),
    enabled: toValue(options?.enabled) ?? true,
  }))

  let activeHours: number | null = null
  let releaseSharedRecords: (() => void) | null = null

  function syncSharedRecordsSubscription(hours: number | null): void {
    if (activeHours === hours)
      return

    releaseSharedRecords?.()
    releaseSharedRecords = null
    activeHours = null

    if (hours === null)
      return

    releaseSharedRecords = retainSharedPingRecordsEntry(hours)
    activeHours = hours
  }

  onScopeDispose(() => {
    syncSharedRecordsSubscription(null)
  })

  // stats 由共享 getRecords 结果派生；共享记录每分钟刷新一次后会自动重算。
  const stats = computed<NodePingStatsState>(() => {
    const { uuid: nodeUuid, hours, enabled } = resolved.value
    if (!enabled || !nodeUuid.trim())
      return createEmptyStats()

    // 通过 getSharedPingRecordsEntry 读取（不存在则创建），确保 computed 始终对
    // entry.data 这个 shallowRef 建立响应式依赖——即便首次加载尚未返回。
    const entry = getSharedPingRecordsEntry(hours)
    const state = entry.data.value
    if (!state)
      return readStatsCache(nodeUuid, hours) ?? createEmptyStats()

    const records = state.recordsByClient.get(nodeUuid) ?? []
    return records.length ? buildStats(records) : createEmptyStats()
  })

  // 副作用：按需触发首次共享加载并维护 loading/error，不再命令式写入 stats。
  watch(
    resolved,
    async (next, _previous, onCleanup) => {
      let cancelled = false
      onCleanup(() => {
        cancelled = true
      })

      const { uuid: nodeUuid, hours, enabled } = next
      if (!enabled || !nodeUuid.trim()) {
        syncSharedRecordsSubscription(null)
        loading.value = false
        error.value = null
        return
      }

      syncSharedRecordsSubscription(hours)
      const entry = getSharedPingRecordsEntry(hours)
      const shouldLoadRecords = !entry.data.value
        || Date.now() - entry.lastFetchedAt >= PING_RECORD_REFRESH_INTERVAL_MS

      if (!shouldLoadRecords) {
        loading.value = false
        error.value = null
        return
      }

      const shouldShowLoading = !entry.data.value
      loading.value = shouldShowLoading
      error.value = null

      try {
        await loadSharedPingRecords(entry, hours)
      }
      catch (err) {
        if (!cancelled && shouldShowLoading)
          error.value = err instanceof Error ? err.message : '获取 Ping 历史失败'
      }
      finally {
        if (!cancelled)
          loading.value = false
      }
    },
    { immediate: true },
  )

  // 共享记录会定时刷新，节流回写 localStorage，避免多节点同时重算时密集写盘。
  const persistStats = useThrottleFn(
    (nodeUuid: string, hours: number, value: NodePingStatsState) => {
      writeStatsCache(nodeUuid, hours, value)
    },
    30_000,
    true,
    true,
  )

  watch(stats, (value) => {
    if (!value.hasData)
      return
    const { uuid: nodeUuid, hours, enabled } = resolved.value
    if (enabled && nodeUuid.trim())
      persistStats(nodeUuid, hours, value)
  })

  return {
    stats,
    loading,
    error,
    history: computed(() => stats.value.history),
    avgLatency: computed(() => stats.value.avgLatency),
    avgLoss: computed(() => stats.value.avgLoss),
    avgVolatility: computed(() => stats.value.avgVolatility),
    hasData: computed(() => stats.value.hasData),
  }
}

export type ChinaCarrierKey = 'unicom' | 'telecom' | 'mobile'

export interface NodeCarrierPingStatsState {
  key: ChinaCarrierKey
  labelZh: string
  labelEn: string
  taskNames: string[]
  stats: NodePingStatsState
  hasLatency: boolean
}

const CHINA_CARRIER_DEFINITIONS: Array<{
  key: ChinaCarrierKey
  labelZh: string
  labelEn: string
  matchers: RegExp[]
}> = [
  {
    key: 'unicom',
    labelZh: '联通',
    labelEn: 'Unicom',
    matchers: [/联通/, /china\s*unicom/i, /\bunicom\b/i, /\bcucc\b/i],
  },
  {
    key: 'telecom',
    labelZh: '电信',
    labelEn: 'Telecom',
    matchers: [/电信/, /china\s*telecom/i, /\btelecom\b/i, /\bctcc\b/i, /\bchinanet\b/i, /\bcn2\b/i],
  },
  {
    key: 'mobile',
    labelZh: '移动',
    labelEn: 'Mobile',
    matchers: [/移动/, /china\s*mobile/i, /\bmobile\b/i, /\bcmcc\b/i, /\bcmi\b/i, /\bcmin2\b/i],
  },
]

function getCarrierForTaskName(taskName: string): ChinaCarrierKey | null {
  for (const definition of CHINA_CARRIER_DEFINITIONS) {
    if (definition.matchers.some(matcher => matcher.test(taskName)))
      return definition.key
  }
  return null
}

function buildSelectedTaskStats(records: PingRecord[]): { stats: NodePingStatsState, hasLatency: boolean } {
  if (!records.length)
    return { stats: createEmptyStats(), hasLatency: false }

  const history = buildPingHistory(records)
  const taskRecords = new Map<number, PingRecord[]>()

  for (const record of records) {
    const currentRecords = taskRecords.get(record.task_id) ?? []
    currentRecords.push(record)
    taskRecords.set(record.task_id, currentRecords)
  }

  const latencyValues: number[] = []
  const lossValues: number[] = []
  const volatilityValues: number[] = []

  for (const recordsByTask of taskRecords.values()) {
    const validValues = recordsByTask
      .map(record => record.value)
      .filter(value => value >= 0)

    if (validValues.length)
      latencyValues.push(average(validValues))

    lossValues.push((recordsByTask.length - validValues.length) / recordsByTask.length * 100)

    if (validValues.length > 1) {
      const p50 = getPercentile(validValues, 0.5)
      const p99 = getPercentile(validValues, 0.99)
      if (isFiniteNumber(p50) && isFiniteNumber(p99) && p50 > FULL_LOSS_EPSILON)
        volatilityValues.push(p99 / p50)
    }
  }

  const hasLatency = latencyValues.length > 0
  return {
    stats: {
      avgLatency: hasLatency ? average(latencyValues) : 0,
      avgLoss: average(lossValues),
      avgVolatility: average(volatilityValues),
      history,
      hasData: true,
    },
    hasLatency,
  }
}

function createEmptyCarrierStats(): NodeCarrierPingStatsState[] {
  return CHINA_CARRIER_DEFINITIONS.map(definition => ({
    key: definition.key,
    labelZh: definition.labelZh,
    labelEn: definition.labelEn,
    taskNames: [],
    stats: createEmptyStats(),
    hasLatency: false,
  }))
}

/**
 * 按 Ping 任务名称识别中国联通 / 中国电信 / 中国移动，并分别计算节点的延迟和丢包。
 * 任务名称可包含：联通/Unicom/CUCC、电信/Telecom/CTCC/CN2、移动/Mobile/CMCC/CMIN2。
 */
export function useNodeCarrierPingStats(
  uuid: MaybeRefOrGetter<string>,
  options?: {
    hours?: MaybeRefOrGetter<number>
    enabled?: MaybeRefOrGetter<boolean>
  },
) {
  const loading = ref(false)
  const error = ref<string | null>(null)

  const resolved = computed(() => ({
    uuid: toValue(uuid),
    hours: Math.max(1, Math.floor(toValue(options?.hours) ?? 1)),
    enabled: toValue(options?.enabled) ?? true,
  }))

  let activeHours: number | null = null
  let releaseSharedRecords: (() => void) | null = null

  function syncSharedRecordsSubscription(hours: number | null): void {
    if (activeHours === hours)
      return

    releaseSharedRecords?.()
    releaseSharedRecords = null
    activeHours = null

    if (hours === null)
      return

    releaseSharedRecords = retainSharedPingRecordsEntry(hours)
    activeHours = hours
  }

  onScopeDispose(() => {
    syncSharedRecordsSubscription(null)
  })

  const carriers = computed<NodeCarrierPingStatsState[]>(() => {
    const { uuid: nodeUuid, hours, enabled } = resolved.value
    if (!enabled || !nodeUuid.trim())
      return createEmptyCarrierStats()

    const state = getSharedPingRecordsEntry(hours).data.value
    if (!state)
      return createEmptyCarrierStats()

    const taskIdsByCarrier = new Map<ChinaCarrierKey, Set<number>>()
    const taskNamesByCarrier = new Map<ChinaCarrierKey, string[]>()

    for (const task of state.tasks) {
      const carrier = getCarrierForTaskName(task.name)
      if (!carrier)
        continue

      const ids = taskIdsByCarrier.get(carrier) ?? new Set<number>()
      ids.add(task.id)
      taskIdsByCarrier.set(carrier, ids)

      const names = taskNamesByCarrier.get(carrier) ?? []
      if (!names.includes(task.name))
        names.push(task.name)
      taskNamesByCarrier.set(carrier, names)
    }

    const nodeRecords = state.recordsByClient.get(nodeUuid) ?? []

    return CHINA_CARRIER_DEFINITIONS.map((definition) => {
      const taskIds = taskIdsByCarrier.get(definition.key) ?? new Set<number>()
      const carrierRecords = taskIds.size
        ? nodeRecords.filter(record => taskIds.has(record.task_id))
        : []
      const calculated = buildSelectedTaskStats(carrierRecords)

      return {
        key: definition.key,
        labelZh: definition.labelZh,
        labelEn: definition.labelEn,
        taskNames: taskNamesByCarrier.get(definition.key) ?? [],
        stats: calculated.stats,
        hasLatency: calculated.hasLatency,
      }
    })
  })

  watch(
    resolved,
    async (next, _previous, onCleanup) => {
      let cancelled = false
      onCleanup(() => {
        cancelled = true
      })

      const { uuid: nodeUuid, hours, enabled } = next
      if (!enabled || !nodeUuid.trim()) {
        syncSharedRecordsSubscription(null)
        loading.value = false
        error.value = null
        return
      }

      syncSharedRecordsSubscription(hours)
      const entry = getSharedPingRecordsEntry(hours)
      const shouldLoadRecords = !entry.data.value
        || Date.now() - entry.lastFetchedAt >= PING_RECORD_REFRESH_INTERVAL_MS

      if (!shouldLoadRecords) {
        loading.value = false
        error.value = null
        return
      }

      const shouldShowLoading = !entry.data.value
      loading.value = shouldShowLoading
      error.value = null

      try {
        await loadSharedPingRecords(entry, hours)
      }
      catch (err) {
        if (!cancelled && shouldShowLoading)
          error.value = err instanceof Error ? err.message : '获取三网 Ping 历史失败'
      }
      finally {
        if (!cancelled)
          loading.value = false
      }
    },
    { immediate: true },
  )

  return {
    carriers,
    loading,
    error,
  }
}
