const legalForms = new Set(['ООО','АО','ПАО','ОАО','ЗАО','ИП','ГУП','МУП','ФГУП','LLC','INC','LTD','LIMITED','CORP','CORPORATION','PLC','GMBH','AG','SA','SARL'])

export function normalizeDigits(value) {
  return String(value ?? '').normalize('NFKC').replace(/[^0-9]/gu, '')
}

export function normalizeCompanyName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[«»“”„‟"'`]/gu, '')
    .replace(/[.,;:()\[\]{}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .split(' ')
    .filter((part) => !legalForms.has(part.toLocaleUpperCase('ru-RU')))
    .join(' ')
    .toLocaleLowerCase('ru-RU')
}

function checksum(digits, weights, divisor) {
  return (weights.reduce((sum, weight, index) => sum + Number(digits[index]) * weight, 0) % divisor) % 10
}

export function validateInn(value) {
  const inn = normalizeDigits(value)
  if (inn.length === 10) return checksum(inn, [2,4,10,3,5,9,4,6,8], 11) === Number(inn[9])
  if (inn.length === 12) {
    return checksum(inn, [7,2,4,10,3,5,9,4,6,8], 11) === Number(inn[10])
      && checksum(inn, [3,7,2,4,10,3,5,9,4,6,8], 11) === Number(inn[11])
  }
  return false
}

export function validateOgrn(value) {
  const ogrn = normalizeDigits(value)
  if (ogrn.length === 13) return Number(ogrn.slice(-1)) === (Number(ogrn.slice(0, -1)) % 11) % 10
  if (ogrn.length === 15) return Number(ogrn.slice(-1)) === (Number(ogrn.slice(0, -1)) % 13) % 10
  return false
}

export function normalizeWebsite(value) {
  if (!value) return null
  const raw = String(value).trim()
  const candidate = /^[a-z][a-z\d+.-]*:\/\//iu.test(raw) ? raw : `https://${raw}`
  let url
  try { url = new URL(candidate) } catch {
    throw new TypeError('Сайт должен быть корректным HTTP(S)-адресом без логина и пароля')
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new TypeError('Сайт должен быть корректным HTTP(S)-адресом без логина и пароля')
  }
  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(/\/+$/u, '') || '/'
  return url.toString().replace(/\/$/u, '')
}

export function normalizeCompanyInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Ожидались данные компании')
  const legalName = String(input.companyName ?? input.legalName ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
  if (!legalName || legalName.length > 300) throw new TypeError('Название компании обязательно и должно быть не длиннее 300 символов')
  const inn = input.inn ? normalizeDigits(input.inn) : null
  const ogrn = input.ogrn ? normalizeDigits(input.ogrn) : null
  if (inn && !validateInn(inn)) throw new TypeError('ИНН имеет неверную длину или контрольную сумму')
  if (ogrn && !validateOgrn(ogrn)) throw new TypeError('ОГРН/ОГРНИП имеет неверную длину или контрольную сумму')
  const website = normalizeWebsite(input.website)
  return {
    legalName,
    normalizedName: normalizeCompanyName(legalName),
    inn,
    ogrn,
    website,
    identityStatus: inn || ogrn ? 'identifier_provided' : 'name_only',
  }
}
