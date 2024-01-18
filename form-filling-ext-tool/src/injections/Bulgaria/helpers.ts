
export function mapDistrict(districtToMap: string): string {
  let returnedDistrict;
  switch (districtToMap) {
    case 'Veliko Turnovo':
      returnedDistrict = 'Veliko Tarnovo';
      break;
    case 'Vraca':
      returnedDistrict = 'Vratsa';
      break;
    case 'Kurdzhali':
      returnedDistrict = 'Kardgali';
      break;
    case 'Kustendil':
      returnedDistrict = 'Kyustendil';
      break;
    case 'Pazardzhik':
      returnedDistrict = 'Pazardgik';
      break;
    case 'Smolian':
      returnedDistrict = 'Smolyan';
      break;
    case 'Sofia (capital)':
      returnedDistrict = 'Sofiya (stolitsa)';
      break;
    case 'Sofia (DISTRICT)':
      returnedDistrict = 'Sofiya';
      break;
    case 'Turgovishte':
      returnedDistrict = 'Targoviщe';
      break;
    case 'Shumen':
      returnedDistrict = 'шumen';
      break;
    case 'Ymbol':
      returnedDistrict = 'Yambol';
      break;
    default:
      returnedDistrict = districtToMap;
  }
  return returnedDistrict;
}

export function mapMunicipality(municipalityToMap: string): string {
  let returnedMunicipality;
  switch (municipalityToMap) {
    case 'Veliko Turnovo':
      returnedMunicipality = 'Veliko Tarnovo';
      break;
    case 'Trambesh':
      returnedMunicipality = 'Trambeш';
      break;
    case 'Svishtov':
      returnedMunicipality = 'Sviщov';
      break;
    case 'Makresh':
      returnedMunicipality = 'Makreш';
      break;
    case 'Vraca':
      returnedMunicipality = 'Vratsa';
      break;
    case 'General Toshevo':
      returnedMunicipality = 'General Toшevo';
      break;
    case 'Krushari':
      returnedMunicipality = 'Kruшari';
      break;
    case 'Shabla':
      returnedMunicipality = 'шabla';
      break;
    case 'Kurdzhali':
      returnedMunicipality = 'Kardgali';
      break;
    case 'Kustendil':
      returnedMunicipality = 'Kyustendil';
      break;
    case 'Boboshevo':
      returnedMunicipality = 'Boboшevo';
      break;
    case 'Varshets':
      returnedMunicipality = 'Varшets';
      break;
    case 'Pazardzhik':
      returnedMunicipality = 'Pazardgik';
      break;
    case 'Panagyurishte':
      returnedMunicipality = 'Panagyuriщe';
      break;
    case 'Peshtera':
      returnedMunicipality = 'Peщera';
      break;
    case 'Perushtitsa':
      returnedMunicipality = 'Peruщitsa';
      break;
    case 'Smolian':
      returnedMunicipality = 'Smolyan';
      break;
    case 'Bogurishte':
      returnedMunicipality = 'Boguriщe';
      break;
    case 'Koprivshtitsa':
      returnedMunicipality = 'Koprivщitsa';
      break;
    case 'Turgovishte':
      returnedMunicipality = 'Targoviщe';
      break;
    case 'Shumen':
      returnedMunicipality = 'шumen';
      break;
    case 'Ymbol':
      returnedMunicipality = 'Yambol';
      break;
    default:
      returnedMunicipality = municipalityToMap;
  }
  return returnedMunicipality;
}
