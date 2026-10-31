/**
 * Mobile numbers can be guessed by their network prefix before porting makes that unreliable. Used only as a fallback
 * when the routed supplier cannot be asked, or does not know, so a prefix is never trusted over a supplier's own
 * lookup. Brand slugs match the catalogue's (`slug()` in `src/suppliers/adapter.ts`, as used by each supplier's
 * operators): Nigeria's `mtn`/`airtel`/`glo`/`9mobile`, Ghana's `mtn`/`telecel`/`airteltigo`, Kenya's
 * `safaricom`/`airtel`/`telkom`.
 */
const prefixTables: Record<string, Array<{ brand: string; prefixes: string[] }>> = {
  NG: [
    { brand: 'mtn', prefixes: ['0803', '0806', '0703', '0706', '0813', '0816', '0810', '0814', '0903', '0906', '0913', '0916'] },
    { brand: 'airtel', prefixes: ['0802', '0808', '0708', '0812', '0701', '0902', '0901', '0904', '0907', '0912'] },
    { brand: 'glo', prefixes: ['0805', '0807', '0705', '0815', '0811', '0905', '0915'] },
    { brand: '9mobile', prefixes: ['0809', '0817', '0818', '0909', '0908'] },
  ],
  GH: [
    { brand: 'mtn', prefixes: ['024', '025', '053', '054', '055', '059'] },
    { brand: 'telecel', prefixes: ['020', '050'] },
    { brand: 'airteltigo', prefixes: ['026', '027', '056', '057'] },
  ],
  KE: [
    { brand: 'safaricom', prefixes: ['0700', '0701', '0702', '0703', '0704', '0705', '0706', '0707', '0708', '0709', '0710', '0711', '0712', '0713', '0714', '0715', '0716', '0717', '0718', '0719', '0720', '0721', '0722', '0723', '0724', '0725', '0726', '0727', '0728', '0729', '0740', '0741', '0742', '0743', '0745', '0746', '0748', '0757', '0758', '0759', '0768', '0769', '0790', '0791', '0792', '0793', '0794', '0795', '0796', '0797', '0798', '0799'] },
    { brand: 'airtel', prefixes: ['0730', '0731', '0732', '0733', '0734', '0735', '0736', '0737', '0738', '0739', '0750', '0751', '0752', '0753', '0754', '0755', '0756', '0762', '0763', '0764', '0765', '0766', '0767', '0768', '0769', '0785', '0786', '0787', '0788', '0789', '0780', '0781', '0782', '0783', '0784'] },
    { brand: 'telkom', prefixes: ['0770', '0771', '0772', '0773', '0774', '0775', '0776', '0777', '0778', '0779'] },
  ],
};

/** Digits only, the leading country dialling code stripped so a national-format prefix table can be matched. */
const dialCodes: Record<string, string> = { NG: '234', GH: '233', KE: '254' };

function national(phone: string, country: string) {
  const digits = phone.replace(/\D/g, '');
  const code = dialCodes[country];
  if (code && digits.startsWith(code)) return `0${digits.slice(code.length)}`;
  return digits.startsWith('0') ? digits : `0${digits}`;
}

/** The network a number is guessed to belong to, from its prefix; null for an unrecognised country or prefix. */
export function detectNetworkByPrefix(phone: string, country: string): string | null {
  const table = prefixTables[country.toUpperCase()];
  if (!table) return null;
  const number = national(phone, country.toUpperCase());
  for (const { brand, prefixes } of table) {
    if (prefixes.some(prefix => number.startsWith(prefix))) return brand;
  }
  return null;
}

/** Whether a country has a prefix table at all (used to decide whether to offer a manual network choice instead). */
export function hasPrefixTable(country: string): boolean {
  return Boolean(prefixTables[country.toUpperCase()]);
}
