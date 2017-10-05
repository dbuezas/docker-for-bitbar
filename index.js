var { exec } = require('child_process');
const bitbar = require('bitbar');
const _ = require('lodash');
let dockerComposeYmlPath;
let dockerPath;

try {
  const config = require('./config');
  dockerPath = config.dockerPath;
  dockerComposeYmlPath = config.dockerComposeYmlPath;
} catch (e) {
  bitbar([
    { text: `🐳 error`, dropdown: false },
    bitbar.sep,
    { text: `Error reading ${__dirname}/config.js` },
    { text: `see config.example.js` },
  ]);
  process.exit(0);
}

const callDocker = async (param) => {
  return new Promise((resolve, reject) => {
    exec(`${dockerPath}/docker ${param}`, { cwd: dockerComposeYmlPath }, (err, result) => {
      if (err) reject(err);
      else resolve(result.toString());
    });
  });
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
  try {
  const psPromise = callDocker('ps', false);
    const statsPromise = callDocker('stats --no-stream', false);
    const out = outputToArray(await psPromise);
    const stats = outputToArray(await statsPromise);
    return _(out)
      .map(obj => {
        const stat = _.find(stats, { container: obj['container id'] }) || {};
        return Object.assign(obj, {
          cpu: stat['cpu %'] || '??',
          ram: stat['mem %'] || '??',
          app: obj.names.replace(/^[^_]+_(.+)_[\d]+$/g, '$1'), // stack_admin_1 => admin
        })
      })
      .sortBy('app')
      .value();
    } catch (e) {
      // docker was probably not started
      return [];
    }
}

const tab = (text, fillSpaces) => {
  let r = text.substr(0, fillSpaces);
  while (r.length < fillSpaces) r += ' ';
  return r;
};

const makeCommand = (commands, text = '') => {
  const command = commands.map(c => `${dockerPath}/${c}`).join(' && ');
  let commandText = commands.join(' && ');
  if (commandText.length > 51) {
    commandText = `${commandText.slice(0, 25)}…${commandText.slice(-25)}`;
  }
  return {
    text: `${tab(text, 70 - commandText.length)} [${commandText}]`,
    size: 12,
    font: 'Courier',
    refresh: false,
    terminal: true,
    bash: `cd ${dockerComposeYmlPath} && ${command}`,
  };
}

const getTabs = (table) => {
  const tabs = {};
  _.forEach(table, line =>
    _.forEach(line, (cell, name) =>
      tabs[name] = Math.min(50, Math.max(cell.length, tabs[name] || 0))
    )
  );
  return tabs;
}

const tabulate = (tabs, line = {}) =>
  ['app', 'image', 'cpu', 'ram', 'status']
  .map(key => tab(line[key] || key.toUpperCase(), tabs[key]))
  .join('  ');

const generateMenu = async () => {
  const table = await getTable();
  const tabs = getTabs(table);
  const conf = table.map(line => {
    return {
      text: tabulate(tabs, line),
      size: 10,
      font: 'Courier',
      terminal: true,
      bash: `${dockerPath}/docker`,
      param1: `logs ${line.names} -f`,
      color: (line.status.startsWith('Up') && line.cpu !== '??' )? 'green' : 'red',
      submenu: [
        { text: line.names },
        makeCommand([`docker-compose pull ${line.app}`], 'Pull'),
        makeCommand([
          `docker-compose scale ${line.app}=0`,
          `docker-compose scale ${line.app}=1`,
        ], 'Restart'),
        makeCommand([`docker-compose scale ${line.app}=0`], 'Stop'),
      ],
    };
  });
  const greens = _.filter(conf, { color: 'green' }).length;
  const reds = _.filter(conf, { color: 'red' }).length;
  const up = greens === 0 ? '' : `${greens}`;
  const down = reds === 0 ? '' : `❌${reds}`;
  const notLoaded = table.length > 0 ? '' : '⛔️';

  const header = {
    size: 10,
    font: 'Courier',
    text: tabulate(tabs),
  }

  bitbar([
    { text: `🐳${up}${down}${notLoaded}`, dropdown: false },
    bitbar.sep,
    { text: 'Refresh ♻️', refresh: true, terminal: false },
    bitbar.sep,
    header,
    ...conf,
    bitbar.sep,
    makeCommand(['docker-compose logs --follow'], 'Logs'),
    makeCommand(['docker-compose up -d --remove-orphans'], 'Restart all'),
    makeCommand(['docker-compose kill'], 'Stop all'),
    makeCommand(['docker-compose pull'], 'Pull all'),
    makeCommand([
      'docker container prune -f',
      'docker volume prune -f',
      'docker image prune -f',
    ], 'Prune stack'),
  ]);
}

generateMenu();
