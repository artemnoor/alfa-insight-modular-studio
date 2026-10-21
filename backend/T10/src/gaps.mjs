export function detectBusinessGaps({ profileId, entities, claims }) {
  const gaps = []
  const edges = claims.filter((claim) => ['CONFIRMED','SUPPORTED'].includes(claim.claim_status))
  const linked = (entityId, predicates) => edges.some((claim) => (claim.subject_entity_id === entityId || claim.object_entity_id === entityId) && predicates.includes(claim.predicate))
  const hasOutgoing = (entityId, predicates) => edges.some((claim) => claim.subject_entity_id === entityId && predicates.includes(claim.predicate))
  const company = entities.find((entity) => entity.entity_type === 'COMPANY')
  if (company && !entities.some((entity) => ['PRODUCT','SERVICE'].includes(entity.entity_type))) {
    gaps.push({ profileId, relatedEntityId: company.entity_id, gapKey: `company:${company.entity_id}:offering`, missingFact: 'Ключевые продукты или услуги компании', importance: 'business_model', rationale: 'Без описания предложения нельзя понять основную деятельность и источники выручки.', priority: 5, suggestedSource: 'Каталог продукции, сайт, анкета клиента или годовой отчёт', question: 'Какие основные продукты или услуги создаёт и продаёт компания?' })
  }
  if (company && entities.some((entity) => ['PRODUCT','SERVICE'].includes(entity.entity_type))
    && !edges.some((claim) => claim.subject_entity_id === company.entity_id && ['PRODUCES','PROVIDES_SERVICE','PURCHASES'].includes(claim.predicate))) {
    gaps.push({ profileId, relatedEntityId: company.entity_id, gapKey: `company:${company.entity_id}:offering_relationship`, missingFact: 'Роль компании в производстве или продаже предложения', importance: 'business_model', rationale: 'Список продуктов без связи с компанией не показывает, производит ли она их, оказывает ли услуги или перепродаёт товар.', priority: 4, suggestedSource: 'Каталог, описание бизнес-модели или коммерческая анкета', question: `Какие из известных продуктов и услуг ${company.canonical_name} производит, оказывает или перепродаёт?` })
  }
  for (const entity of entities) {
    if (entity.entity_type === 'PRODUCT' && !edges.some((claim) => claim.subject_entity_id === entity.entity_id && ['REQUIRES','USES'].includes(claim.predicate))) {
      gaps.push({ profileId, relatedEntityId: entity.entity_id, gapKey: `product:${entity.entity_id}:inputs`, missingFact: 'Компоненты, материалы и ресурсы продукта', importance: 'supply_dependency', rationale: 'Состав ключевого продукта нужен для выявления операционных и поставочных зависимостей.', priority: 4, suggestedSource: 'Спецификация изделия, технологическая карта или BOM', question: `Какие основные компоненты, материалы и ресурсы нужны для продукта «${entity.canonical_name}»?` })
    }
    if (entity.entity_type === 'SERVICE' && !edges.some((claim) => claim.subject_entity_id === company?.entity_id && claim.object_entity_id === entity.entity_id && claim.predicate === 'PROVIDES_SERVICE')) {
      gaps.push({ profileId, relatedEntityId: entity.entity_id, gapKey: `service:${entity.entity_id}:provider`, missingFact: 'Связь услуги с компанией', importance: 'business_model', rationale: 'Упоминание услуги само по себе не подтверждает, что её оказывает именно эта компания.', priority: 4, suggestedSource: 'Каталог услуг или договор оказания услуг', question: `Оказывает ли ${company?.canonical_name ?? 'компания'} услугу «${entity.canonical_name}» и кому?` })
    }
    if (entity.entity_type === 'PRODUCT' && company
      && !edges.some((claim) => claim.object_entity_id === entity.entity_id && claim.subject_entity_id === company.entity_id && ['PRODUCES','PURCHASES'].includes(claim.predicate))) {
      gaps.push({ profileId, relatedEntityId: entity.entity_id, gapKey: `product:${entity.entity_id}:company_role`, missingFact: 'Роль компании в цепочке продукта', importance: 'business_model', rationale: 'Неизвестно, производит ли компания продукт сама или получает его от поставщиков.', priority: 4, suggestedSource: 'Технологическая карта, каталог или договор поставки', question: `Компания производит продукт «${entity.canonical_name}» сама или закупает его у поставщика?` })
    }
    if (entity.entity_type === 'FACILITY' && !linked(entity.entity_id, ['LOCATED_IN'])) {
      gaps.push({ profileId, relatedEntityId: entity.entity_id, gapKey: `facility:${entity.entity_id}:location`, missingFact: 'Местоположение площадки', importance: 'operations', rationale: 'География площадки нужна для анализа логистики, доступности ресурсов и локальных рисков.', priority: 3, suggestedSource: 'Паспорт объекта, адрес филиала или реестр недвижимости', question: `Где расположена площадка «${entity.canonical_name}»?` })
    }
    if (entity.entity_type === 'FACILITY' && !hasOutgoing(entity.entity_id, ['USES','REQUIRES'])) {
      gaps.push({ profileId, relatedEntityId: entity.entity_id, gapKey: `facility:${entity.entity_id}:resources`, missingFact: 'Ключевые ресурсы производственной площадки', importance: 'operations', rationale: 'Без ресурсов площадки нельзя оценить её операционные ограничения и критические зависимости.', priority: 3, suggestedSource: 'Технический паспорт площадки или операционная анкета', question: `Какие ключевые ресурсы нужны для работы площадки «${entity.canonical_name}»?` })
    }
    if (entity.entity_type === 'COMPONENT' && !linked(entity.entity_id, ['SUPPLIES','PURCHASES'])) {
      gaps.push({ profileId, relatedEntityId: entity.entity_id, gapKey: `component:${entity.entity_id}:supplier`, missingFact: 'Поставщик компонента', importance: 'supply_dependency', rationale: 'Без поставщика нельзя оценить концентрацию и заменяемость поставки.', priority: 4, suggestedSource: 'Реестр поставщиков или действующий договор', question: `Кто поставляет компонент «${entity.canonical_name}» и есть ли альтернативные поставщики?` })
    }
    if (entity.entity_type === 'RESOURCE' && !linked(entity.entity_id, ['SUPPLIES','PURCHASES','REQUIRES'])) {
      gaps.push({ profileId, relatedEntityId: entity.entity_id, gapKey: `resource:${entity.entity_id}:supplier`, missingFact: 'Источник критичного ресурса', importance: 'operations', rationale: 'Источник ресурса необходим для понимания непрерывности бизнес-процесса.', priority: 3, suggestedSource: 'Операционная анкета или договор снабжения', question: `Откуда компания получает ресурс «${entity.canonical_name}» и какие есть альтернативы?` })
    }
    if (entity.entity_type === 'PROCESS' && !hasOutgoing(entity.entity_id, ['REQUIRES','USES','DEPENDS_ON'])) {
      gaps.push({ profileId, relatedEntityId: entity.entity_id, gapKey: `process:${entity.entity_id}:inputs`, missingFact: 'Ресурсы и зависимости процесса', importance: 'operations', rationale: 'Входы процесса нужны для выявления узких мест и операционных зависимостей.', priority: 3, suggestedSource: 'Регламент процесса или операционная анкета', question: `Какие ресурсы, системы и внешние стороны необходимы для процесса «${entity.canonical_name}»?` })
    }
    if (entity.entity_type === 'CONTRACT' && !entity.attributes?.validFrom && !entity.attributes?.validTo && !entity.attributes?.relationshipStatus) {
      gaps.push({ profileId, relatedEntityId: entity.entity_id, gapKey: `contract:${entity.entity_id}:term`, missingFact: 'Срок и статус договора', importance: 'contractual_dependency', rationale: 'Без срока действия нельзя понять, действует ли договор и актуальна ли связанная зависимость.', priority: 4, suggestedSource: 'Подписанный договор или карточка договора', question: `Каковы дата начала, срок окончания и текущий статус договора «${entity.canonical_name}»?` })
    }
  }
  if (company) {
    const suppliers = new Set(edges.filter((claim) => ['PURCHASES','SUPPLIES','CONTRACTED_WITH'].includes(claim.predicate))
      .flatMap((claim) => claim.subject_entity_id === company.entity_id ? [claim.object_entity_id] : claim.object_entity_id === company.entity_id ? [claim.subject_entity_id] : []))
    for (const supplierId of suppliers) {
      const supplier = entities.find((entity) => entity.entity_id === supplierId && entity.entity_type === 'COMPANY')
      if (supplier && !edges.some((claim) => ['PURCHASES','SUPPLIES'].includes(claim.predicate) && (claim.subject_entity_id === supplierId || claim.object_entity_id === supplierId) && claim.attributes?.alternativeSuppliersKnown === true)) {
        gaps.push({ profileId, relatedEntityId: supplier.entity_id, gapKey: `supplier:${supplier.entity_id}:alternatives`, missingFact: 'Альтернативные поставщики', importance: 'supply_resilience', rationale: 'Известная зависимость от поставщика не показывает, можно ли заменить его при перебое.', priority: 4, suggestedSource: 'Реестр поставщиков, договор или карта критичных закупок', question: `Есть ли альтернативные поставщики вместо «${supplier.canonical_name}» и сколько времени занимает переключение?` })
      }
    }
  }
  return gaps
}
