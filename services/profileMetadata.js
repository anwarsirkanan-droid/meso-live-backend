const COUNTRY_FLAGS = {
  Ethiopia: '🇪🇹',
  Kenya: '🇰🇪',
  Nigeria: '🇳🇬',
  Philippines: '🇵🇭',
  'Saudi Arabia': '🇸🇦',
  UAE: '🇦🇪',
  'United Arab Emirates': '🇦🇪',
  Somalia: '🇸🇴',
  Sudan: '🇸🇩',
  Egypt: '🇪🇬',
  Ghana: '🇬🇭',
  Tanzania: '🇹🇿',
  Uganda: '🇺🇬',
  France: '🇫🇷',
  Portugal: '🇵🇹',
  Indonesia: '🇮🇩',
  India: '🇮🇳',
  Nepal: '🇳🇵',
  Myanmar: '🇲🇲',
  'United States': '🇺🇸',
  'United Kingdom': '🇬🇧',
};

function calculateAge(birthday) {
  if (!birthday) return null;
  const date = new Date(birthday);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  if (today.getMonth() < date.getMonth() || (today.getMonth() === date.getMonth() && today.getDate() < date.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function countryFlag(country) {
  if (!country) return '';
  if (/\p{Extended_Pictographic}/u.test(country)) return country;
  return COUNTRY_FLAGS[country] || '';
}

function withProfileMetadata(profile) {
  const value = typeof profile.toObject === 'function' ? profile.toObject() : { ...profile };
  value.isAgent = value.isAgent === true || String(value.role || '').toUpperCase() === 'AGENT';
  value.isHost = !value.isAgent && (value.isHost === true || String(value.role || '').toUpperCase() === 'HOST');
  value.age = calculateAge(value.birthday);
  value.countryFlag = value.countryFlag || countryFlag(value.country);
  value.agencyName = (
    value.agencyId && typeof value.agencyId === 'object'
      ? value.agencyId.agencyName || value.agencyId.name
      : ''
  ) || value.agencyName || '';
  value.customId = value.customId || value.publicId || value.id || value._id;
  return value;
}

module.exports = { calculateAge, countryFlag, withProfileMetadata };
