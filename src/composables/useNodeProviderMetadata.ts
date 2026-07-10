import type { MaybeRefOrGetter } from 'vue'
import type { NodeData } from '@/stores/nodes'
import type { IpGeo } from '@/utils/ipGeoHelper'
import type { ProviderResolveResult } from '@/utils/providerInfo'
import { ref, toValue, watch } from 'vue'
import { lookupIpGeo } from '@/utils/ipGeoHelper'
import { resolveProviderInfo } from '@/utils/providerInfo'

export interface NodeProviderMetadata {
  provider: ProviderResolveResult | null
  geo: IpGeo | null
  loading: boolean
}

interface CacheEntry {
  fingerprint: string
  metadata: NodeProviderMetadata
}

interface UseNodeProviderMetadataOptions {
  nodes: MaybeRefOrGetter<NodeData[]>
  customAliases: MaybeRefOrGetter<string>
  enabled?: MaybeRefOrGetter<boolean>
}

function getNodeIps(node: NodeData): string[] {
  return [node.ipv4, node.ipv6].filter((ip): ip is string => Boolean(ip?.trim()))
}

function getProviderMetadataText(node: NodeData): string {
  return [node.name, node.public_remark, node.remark, node.tags, node.group, node.region]
    .filter(Boolean)
    .join(' ')
}

function getFingerprint(node: NodeData, customAliases: string): string {
  return [
    node.uuid,
    node.name,
    node.public_remark,
    node.remark,
    node.tags,
    node.group,
    node.region,
    node.ipv4,
    node.ipv6,
    customAliases,
  ].join('')
}

async function lookupNodeGeo(node: NodeData): Promise<IpGeo | null> {
  for (const ip of getNodeIps(node)) {
    const geo = await lookupIpGeo(ip)
    if (geo)
      return geo
  }
  return null
}

function buildNodeProviderMetadata(node: NodeData, customAliases: string, geo: IpGeo | null, loading: boolean): NodeProviderMetadata {
  return {
    geo,
    loading,
    provider: resolveProviderInfo({
      metadata: getProviderMetadataText(node),
      org: geo?.org,
      asn: geo?.asn,
      customAliases,
    }),
  }
}

export function useNodeProviderMetadata(options: UseNodeProviderMetadataOptions) {
  const metadataByUuid = ref<Record<string, NodeProviderMetadata>>({})
  const cache = new Map<string, CacheEntry>()
  const activeFingerprints = new Map<string, string>()
  let refreshSeq = 0

  function getNodeProviderMetadata(node: NodeData): NodeProviderMetadata | null {
    return metadataByUuid.value[node.uuid] ?? null
  }

  watch(
    () => {
      const nodes = toValue(options.nodes)
      const customAliases = toValue(options.customAliases)
      const enabled = options.enabled === undefined ? true : toValue(options.enabled)
      return {
        customAliases,
        enabled,
        fingerprint: nodes.map(node => getFingerprint(node, customAliases)).join(''),
      }
    },
    ({ customAliases, enabled }) => {
      const seq = ++refreshSeq
      const nodes = toValue(options.nodes)
      const nextMetadata: Record<string, NodeProviderMetadata> = {}
      activeFingerprints.clear()

      if (!enabled) {
        metadataByUuid.value = nextMetadata
        return
      }

      for (const node of nodes) {
        const fingerprint = getFingerprint(node, customAliases)
        activeFingerprints.set(node.uuid, fingerprint)

        const cached = cache.get(node.uuid)
        if (cached?.fingerprint === fingerprint) {
          nextMetadata[node.uuid] = cached.metadata
          continue
        }

        const hasIps = getNodeIps(node).length > 0
        const initialMetadata = buildNodeProviderMetadata(node, customAliases, null, hasIps)
        nextMetadata[node.uuid] = initialMetadata
        cache.set(node.uuid, { fingerprint, metadata: initialMetadata })

        if (!hasIps)
          continue

        void lookupNodeGeo(node).then((geo) => {
          if (seq !== refreshSeq || activeFingerprints.get(node.uuid) !== fingerprint)
            return

          const resolvedMetadata = buildNodeProviderMetadata(node, customAliases, geo, false)
          cache.set(node.uuid, { fingerprint, metadata: resolvedMetadata })
          metadataByUuid.value = {
            ...metadataByUuid.value,
            [node.uuid]: resolvedMetadata,
          }
        })
      }

      metadataByUuid.value = nextMetadata
    },
    { immediate: true },
  )

  return {
    metadataByUuid,
    getNodeProviderMetadata,
  }
}
