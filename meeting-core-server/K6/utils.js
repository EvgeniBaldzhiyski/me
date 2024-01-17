export function generateMessage(method, data) {
  return JSON.stringify({ data: data, method: method });
}

export function parseMessage(pack) {
  try{
    return JSON.parse(pack);
  } catch(err) {
    return null;
  }
}

export function generateUrl(appName, env) {
  return 'wss://sock.' + (env || 'local') + '.domain.com/meeting/' + appName + '?aid=1&mode=sut';
}
