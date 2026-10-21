import { RELATION_COMPATIBILITY } from './relationships.mjs'

const normalizeText = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/[«»“”„‟"'`.,;:()[\]{}]+/gu,' ').replace(/\s+/gu,' ').trim()
const numericAttributeKeys = new Set(['amount','quantity','volume','capacity','percentage','percent','duration','employees','workplaces','value','count','shares','share_percent'])
const dateAttributeKeys = new Set(['validfrom','validto','date','publishedat','startdate','enddate'])
const ignoredAttributeKeys = new Set(['relationshipstatus','status','source','sourceid','chunkid'])

function normalizeRoleText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru-RU')
    .replace(/[«»“”„‟"'`]+/gu, '').replace(/\s+/gu, ' ').trim()
}

function commercialRoleInQuote(quote, participant) {
  const text = normalizeRoleText(quote)
  const name = normalizeRoleText(participant?.name)
  if (!name) return null
  const index = text.indexOf(name)
  if (index < 0) return null
  const boundaryBefore = Math.max(text.lastIndexOf('.', index), text.lastIndexOf(';', index), text.lastIndexOf('!', index), text.lastIndexOf('?', index))
  const boundaryAfter = [text.indexOf('.', index + name.length), text.indexOf(';', index + name.length), text.indexOf('!', index + name.length), text.indexOf('?', index + name.length)].filter((position) => position >= 0)
  const clauseStart = boundaryBefore < 0 ? 0 : boundaryBefore + 1
  const clauseEnd = boundaryAfter.length ? Math.min(...boundaryAfter) : text.length
  const before = text.slice(clauseStart, index)
  const clause = text.slice(clauseStart, clauseEnd)
  const supplierCue = /поставщик[а-яё]*|поставля[а-яё]*|продавец|прода[её]т|продал[а-яё]*|supplier|suppl(?:y|ies|ied)|seller|sells|sold|deliver(?:s|ed|y)/iu.test(clause)
  const buyerCue = /закуп[а-яё]*|покупа[а-яё]*|приобрета[а-яё]*|покупател[а-яё]*|заказчик|получател[а-яё]*|buyer|customer|purchas(?:e|es|ed|ing)|bought|buys|recipient/iu.test(clause)
  const isSellerSource = /(?:^|\s)(?:у|от|from|by)\s*$/iu.test(before)
  return { supplier: supplierCue || isSellerSource, buyer: buyerCue }
}

function validateRelationDirection(proposal, quote, subject, object) {
  if (!['SUPPLIES','PURCHASES'].includes(proposal.predicate) || subject?.type !== 'COMPANY') return null
  const role = commercialRoleInQuote(quote, subject)
  if (!role) return null
  if (proposal.predicate === 'SUPPLIES' && role.buyer && !role.supplier) {
    return 'Направление SUPPLIES отклонено: субъект в цитате обозначен как покупатель, а не поставщик'
  }
  if (proposal.predicate === 'PURCHASES' && role.supplier && !role.buyer) {
    return 'Направление PURCHASES отклонено: субъект в цитате обозначен как поставщик, а не покупатель'
  }
  return null
}

function validateClaimStatus(proposal, quote) {
  const text = normalizeRoleText(quote)
  if (proposal.status === 'CURRENT' && /(?:не\s+(?!только\b)(?:поставля|закуп|покупа|приобрета)|не\s+осуществля[а-яё]*\s+поставк|нет\s+(?:текущих\s+)?поставок|расторгнут[а-яё]*|прекращён[а-яё]*|прекращен[а-яё]*|истёк|истек|terminated|expired|has ended|no current supplies)/iu.test(text)) {
    return 'Статус CURRENT противоречит отрицанию или прекращению в цитате'
  }
  if (proposal.status === 'CURRENT' && /(?:планирует|планируют|планируем|запланирован|намерен|собирается|будет\s+поставля|будут\s+поставля|если\s+.*(?:постав|закуп)|при\s+условии|в\s+случае|plans? to|intends? to|will\s+(?:supply|purchase|deliver)|subject to)/iu.test(text)) {
    return 'Статус CURRENT не подтверждён: цитата описывает план или условие'
  }
  return null
}

function validatePartOfPredicate(proposal, quote) {
  if (proposal.predicate !== 'PART_OF') return null
  const text = normalizeRoleText(quote)
  const partCue = /(?:part of|subsidiary of|division of|business unit of|belongs to|within|includes?|comprises?|consists? of|arm of|brand of|часть компании|частью компании|входит в состав|включа[а-яё]*|состоит из|дочерн[а-яё]*|подразделени[а-яё]*|филиал[а-яё]*)/iu
  if (partCue.test(text)) return null
  const mergerCue = /(?:merged? with|merger|amalgamat|слияни[а-яё]*|объединил[а-яё]*с)/iu
  if (mergerCue.test(text)) return 'PART_OF не подтверждается: цитата описывает объединение компаний, но не отношение части и целого'
  return 'PART_OF не подтверждается явным указанием на включение, подразделение или отношение части и целого'
}

function flattenAttributes(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [[prefix, value]]
  return Object.entries(value).flatMap(([key, child])=>flattenAttributes(child,prefix ? `${prefix}.${key}` : key))
}

function sourceContainsNumber(quote, value) {
  const numeric = Number(String(value).replace(',','.'))
  if (!Number.isFinite(numeric)) return normalizeText(quote).includes(normalizeText(value))
  const tokens = String(quote).match(/\d+(?:[.,]\d+)?/gu) ?? []
  return tokens.some((token)=>Number(token.replace(',','.'))===numeric)
}

export function validateAttributesAgainstQuote(attributes, quote) {
  const problems=[]
  for (const [path,value] of flattenAttributes(attributes)) {
    const key=path.split('.').at(-1).toLocaleLowerCase('en-US').replace(/[_-]/gu,'')
    if (value == null || ignoredAttributeKeys.has(key)) continue
    if (numericAttributeKeys.has(key)) {
      if (!sourceContainsNumber(quote,value)) problems.push(`Числовой атрибут ${path} не подтверждён цитатой`)
      continue
    }
    if (dateAttributeKeys.has(key)) {
      const text=normalizeText(quote)
      const dateText=normalizeText(value)
      if (!dateText || !text.includes(dateText)) problems.push(`Дата ${path} не совпадает с текстом цитаты`)
      continue
    }
    if (['unit','currency','qualifier'].includes(key)) {
      if (typeof value==='string' && !normalizeText(quote).includes(normalizeText(value))) problems.push(`Единица или квалификатор ${path} не подтверждён цитатой`)
      continue
    }
    if (typeof value === 'string' && /[\p{L}\p{N}]{3}/u.test(value) && !normalizeText(quote).includes(normalizeText(value))) {
      problems.push(`Атрибут ${path} не подтверждён цитатой`)
    }
  }
  return problems
}

function explicitInterval(attributes) {
  const from=attributes?.validFrom ?? attributes?.startDate
  const to=attributes?.validTo ?? attributes?.endDate
  if (!from || !to) return null
  const start=Date.parse(from), end=Date.parse(to)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start>end) return null
  return {start,end}
}

function intervalsOverlap(left,right) { return Boolean(left && right && left.start<=right.end && right.start<=left.end) }

function contradictoryAttributes(left = {}, right = {}) {
  const ignored=new Set(['relationshipStatus','validFrom','validTo','startDate','endDate'])
  for (const [key,value] of Object.entries(left)) {
    if (ignored.has(key) || !(key in right)) continue
    const other=right[key]
    if (value == null || other == null || typeof value === 'object' || typeof other === 'object') continue
    if (normalizeText(value)!==normalizeText(other)) return {key,left:value,right:other}
  }
  const leftStatus=left.relationshipStatus, rightStatus=right.relationshipStatus
  if (leftStatus && rightStatus && leftStatus!==rightStatus && ['CURRENT','ENDED'].includes(leftStatus) && ['CURRENT','ENDED'].includes(rightStatus)) return {key:'relationshipStatus',left:leftStatus,right:rightStatus}
  return null
}

function sameRelationship(left,right) {
  return normalizeText(left.subject?.name ?? left.sourceName ?? left.subject_name)===normalizeText(right.subject?.name ?? right.sourceName ?? right.subject_name)
    && normalizeText(left.object?.name ?? left.targetName ?? left.object_name)===normalizeText(right.object?.name ?? right.targetName ?? right.object_name)
    && left.predicate===right.predicate
}

export function verifyBusinessProposal(proposal, { sourceText, sourceId, sourceStatus = 'available', sourceAccessLevel = 'customer_internal', subject, object }) {
  const errors = []
  if (!sourceId || !['available','processed'].includes(sourceStatus)) errors.push('Источник отсутствует или недоступен')
  if (typeof sourceText !== 'string' || !sourceText) errors.push('Не сохранён исходный текст')
  const quote = String(proposal.quote ?? '')
  const offset = sourceText?.indexOf(quote) ?? -1
  if (!quote || offset < 0) errors.push('Цитата не совпадает с исходным документом')
  const pair = RELATION_COMPATIBILITY[proposal.predicate]
  if (!pair) errors.push('Неизвестный тип связи')
  else if (!subject || !object || !pair[0].includes(subject.type) || !pair[1].includes(object.type)) errors.push('Типы сущностей несовместимы с отношением')
  const subjectQuoted = subject && quote.toLocaleLowerCase('ru-RU').includes(subject.name.toLocaleLowerCase('ru-RU'))
  const objectQuoted = object && quote.toLocaleLowerCase('ru-RU').includes(object.name.toLocaleLowerCase('ru-RU'))
  if (subject && !subjectQuoted) {
    const reference = proposal.sourceResolution?.evidenceTerm ?? subject.resolution?.evidenceTerm
    const method = proposal.sourceResolution?.method ?? subject.resolution?.method
    const aliasQuoted = method === 'exact_alias_quote' && reference && normalizeText(quote).includes(normalizeText(reference))
    const inflectedMentionQuoted = ['exact_surface_variant','exact_alias_variant'].includes(method) && reference && normalizeText(quote).includes(normalizeText(reference))
    const uniqueLocalReference = method === 'unique_preceding_mention' && reference && normalizeText(quote).includes(normalizeText(reference))
    if (!aliasQuoted && !inflectedMentionQuoted && !uniqueLocalReference) errors.push('Цитата не содержит субъект и не имеет однозначной локальной ссылки')
  }
  if (object && !objectQuoted) {
    const reference = proposal.targetResolution?.evidenceTerm ?? object.resolution?.evidenceTerm
    const method = proposal.targetResolution?.method ?? object.resolution?.method
    const aliasQuoted = method === 'exact_alias_quote' && reference && normalizeText(quote).includes(normalizeText(reference))
    const inflectedMentionQuoted = ['exact_surface_variant','exact_alias_variant'].includes(method) && reference && normalizeText(quote).includes(normalizeText(reference))
    const uniqueLocalReference = method === 'unique_preceding_mention' && reference && normalizeText(quote).includes(normalizeText(reference))
    if (!aliasQuoted && !inflectedMentionQuoted && !uniqueLocalReference) errors.push('Цитата не содержит объект и не имеет однозначной локальной ссылки')
  }
  if (proposal.status && !['CURRENT','PLANNED','CONDITIONAL','ENDED','UNKNOWN'].includes(proposal.status)) errors.push('Недопустимый статус отношения')
  const directionProblem = validateRelationDirection(proposal, quote, subject, object)
  if (directionProblem) errors.push(directionProblem)
  const statusProblem = validateClaimStatus(proposal, quote)
  if (statusProblem) errors.push(statusProblem)
  const predicateProblem = validatePartOfPredicate(proposal, quote)
  if (predicateProblem) errors.push(predicateProblem)
  const date = proposal.attributes?.validFrom ?? proposal.attributes?.validTo
  if (date != null && Number.isNaN(Date.parse(date))) errors.push('Дата отношения не распознана backend')
  errors.push(...validateAttributesAgainstQuote(proposal.attributes ?? {}, quote))
  return errors.length ? {
    accepted: false, status: 'REJECTED', errors,
    rejectedProposal: { proposal, sourceId, reason: errors.join('; ') },
  } : {
    accepted: true,
    claimStatus: 'SUPPORTED', // Exact text evidence does not establish independent truth.
    evidence: { sourceId, quote, startOffset: offset, endOffset: offset + quote.length, quoteMatchesSource: true, sourceAccessLevel, factValidation: proposal.semanticVerification?.status === 'SUPPORTED' ? 'model_supported' : 'text_match_only' },
    relationshipStatus: proposal.status ?? 'UNKNOWN',
  }
}

export function verifyBatch(proposals, sourceLookup, existingClaims = []) {
  const accepted = []
  const rejected = []
  const conflicts = []
  for (const proposal of proposals) {
    const source = sourceLookup(proposal.sourceId)
    const result = verifyBusinessProposal(proposal, {
      sourceText: source?.content_text,
      sourceId: source?.source_id,
      sourceStatus: source?.source_status,
      sourceAccessLevel: source?.access_level,
      subject: proposal.subject,
      object: proposal.object,
    })
    if (result.accepted) accepted.push({ ...proposal, ...result })
    else rejected.push(result.rejectedProposal)
  }
  const knownClaims=[...existingClaims.map((claim)=>({ ...claim, existing:true })),...accepted]
  for (const item of accepted) {
    for (let index=0;index<knownClaims.length;index+=1) {
      const previous=knownClaims[index]
      if (previous===item || !sameRelationship(item,previous)) continue
      if (!previous.existing && accepted.indexOf(previous)>=accepted.indexOf(item)) continue
      const previousAttributes={...(previous.attributes??{}),relationshipStatus:previous.relationshipStatus??previous.status??previous.attributes?.relationshipStatus}
      const currentAttributes={...(item.attributes??{}),relationshipStatus:item.relationshipStatus??item.status??item.attributes?.relationshipStatus}
      const previousInterval=explicitInterval(previousAttributes)
      const currentInterval=explicitInterval(currentAttributes)
      if (!intervalsOverlap(previousInterval,currentInterval)) continue
      const conflict=contradictoryAttributes(currentAttributes,previousAttributes)
      if (!conflict) continue
      item.claimStatus='CONFLICTED'
      item.conflictsWithClaimIds=[...(item.conflictsWithClaimIds??[]),previous.claim_id].filter(Boolean)
      conflicts.push({ proposal:item, conflictingClaimId:previous.claim_id??null, conflictingEvidence:previous.evidence??[], reason:`Противоречие в атрибуте ${conflict.key} для пересекающихся периодов: ${String(conflict.left)} vs ${String(conflict.right)}` })
      if (!previous.existing) {
        previous.claimStatus='CONFLICTED'
        previous.conflictsWithClaimIds=[...(previous.conflictsWithClaimIds??[]),item.claim_id].filter(Boolean)
      }
    }
  }
  return { blockId: 'B07', status: rejected.length || conflicts.length ? (accepted.length ? 'partial' : 'failed') : 'completed', accepted, rejected, conflicts }
}
