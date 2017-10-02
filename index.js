const shell = require('shellpromise');
const bitbar = require('bitbar');
const _ = require('lodash');
const nodePath = process.argv[0];
const { dockerComposeYmlPath, dockerPath } = require('./config');

const docker = async (param, notify = true) => {
  const result = await shell(`${dockerPath}/docker ${param}`, { cwd: dockerComposeYmlPath });
  if (notify) {
    const r = result.replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    shell(`osascript -e $'tell app "System Events" to display dialog "${r}" buttons "OK" default button 1 with title "${`docker-compose ${param}`}"'`)
  }
  return result;
}
const dockerCompose = async (param, notify = true) =>{
  const result = await shell(`${dockerPath}/docker-compose ${param}`, { cwd: dockerComposeYmlPath });
  // if (notify) notifier.notify({ title: `docker-compose ${param}`, message: result });
  if (notify) {
    const r = result.replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    shell(`osascript -e $'tell app "System Events" to display dialog "${r}" buttons "OK" default button 1 with title "${`docker-compose ${param}`}"'`)
  }
  return result;
}

const outputToArray = (out) => {
  const lines = out.trim().split('\n');
  const headersLine = lines.shift();
  const headers = headersLine.split(/\s{2,}/);
  const offsets = headers.map(title => headersLine.indexOf(title));
  return _(lines)
    .map(line => {
      const cells = offsets.map((offset, i) =>
        line.slice(offsets[i], offsets[i+1]).trim()
      );
      return _.mapKeys(cells, (cell, i) =>
        headers[i].toLowerCase()
      );
    })
    .value()
}

const getTable = async () => {
  const out = outputToArray(await docker('ps', false));
  const stats = outputToArray(await docker('stats --no-stream', false));
  return _(out)
    .map(obj => {
      const stat = stats.find(({ container }) => container === obj['container id']);
      return Object.assign(obj, {
        cpu: stat['cpu %'],
        ram: stat['mem %'],
        app: obj.names.replace(/^[^_]+_(.+)_[\d]+$/g, '$1'), // stack_admin_1 => admin
      })
    })
    .sortBy('app')
    .value();
}

const makeCommand = (prg, command, text = `${command}`) => ({
  text,
  refresh: true,
  terminal: false,
  bash: nodePath,
  param1: __filename,
  param2: prg,
  param3: command,
});

const generateMenu = async () => {
  const table = await getTable();
  const conf = table.map(({ app, names, status, image, cpu, ram }) => {
    const tab1 = _.times(20 - Math.min(app.length, 19)).map(() => ' ').join('');
    const tab2 = _.times(40 - Math.min(image.length, 39)).map(() => ' ').join('');
    const usage = `${cpu} / ${ram}`;
    const tab3 = _.times(20 - usage.length).map(() => ' ').join('');
    return {
      text: `${app.substr(0,19)}${tab1}${image.substr(0,39)}${tab2}${usage}${tab3}${status}`,
      font: 'Courier',
      terminal: true,
      bash: `${dockerPath}/docker`,
      param1: `logs ${names} -f`,
      size: 10,
      color: status.startsWith('Up') ? 'green' : 'red',
      submenu: [
        { text: app },
        makeCommand('docker-compose', `scale ${app}=0`, 'stop'),
        makeCommand('restart', app, '(re)start'),
        makeCommand('docker-compose', `pull ${app}`, 'pull'),
        makeCommand('docker-compose', `logs ${app}`, 'logs'),
      ],
    };
  });
  const greens = _.filter(conf, { color: 'green' }).length;
  const reds = _.filter(conf, { color: 'red' }).length;
  const up = greens === 0 ? '' : `${greens}`;
  const down = reds === 0 ? '' : `❌${reds}`;
  const notLoaded = table.length > 0 ? '' : '⛔️';
  bitbar([
    { text: `🐳${up}${down}${notLoaded}`, dropdown: false },
    bitbar.sep,
    { text: 'Refresh ♻️', refresh: true, terminal: false },
    bitbar.sep,
    makeCommand('docker-compose', 'up -d --remove-orphans', '(re)load docker-compose.yml'),
    makeCommand('docker-compose', 'kill'),
    makeCommand('docker-compose', 'pull'),
    bitbar.sep,
    makeCommand('prune', '', 'Prune stack'),
    bitbar.sep,
    ...conf,
  ]);
}

const start = async () => {
  const command = process.argv[2];
  const params = process.argv.slice(3).join(' ');
  switch (command) {
    case 'docker':
      await docker(params);
      break;
    case 'docker-compose':
      await dockerCompose(params);
      break;
    case 'restart':
      await dockerCompose(`scale ${params}=0`);
      await dockerCompose(`scale ${params}=1`);
      break;
    case 'prune':
      await docker('container prune -f');
      await docker('volume prune -f');
      await docker('image prune -f');
      break;
    default:
      generateMenu();
  }
}
start();
