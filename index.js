import {existsSync, lstat, readFile} from "node:fs";
import {resolve as pathResolve} from "node:path";
import {inspect, format} from "node:util";

import Validator from "lintspaces";
import * as types from "lintspaces/src/constants/types.js";
import {program} from "commander";
import {glob} from "glob";
import "colors";

const VERBOSE_KEYS = [`-v`, `--verbose`];
const VERBOSE = process.argv.some((element) => VERBOSE_KEYS.includes(element));
const DEFAULT_EDITORCONFIG_NAME = `.editorconfig`;
const JSON_CONFIG_PROPERTY_NAME = `editorconfig-cli`;
const DEFAULT_JSON_FILENAME = `package.json`;


// Iterate over object props
Object.prototype[Symbol.iterator] = function* () {
  for (const [key, value] of Object.entries(this)) {
    yield [key, value];
  }
};

const log = {
  fatal(message) {
    console.log(message.red);
    process.exit(1);
  },
  info: console.log,
  error: console.warn,
  debug: (message) => {
    if (VERBOSE) {
      console.log(message);
    }
  }
};

const resolve = (filename) => {
  const resolved = pathResolve(filename);
  return existsSync(resolved) ? resolved : null;
};

const checkEditorConfig = function (filename) {
  const filePath = resolve(filename);

  if (!filePath) {
    log.fatal(`Error: Specified .editorconfig "${filename}" doesn\'t exist`);
    return null;
  }

  log.info(`Using \'.editorconfig\' from: "${filePath}"`);

  // BC! .editorconfig lib inside is looking for all possible paths relatively
  // So there is no way to pass absolute path
  // Absolute path will break on WinOS
  return filename;
};

const collect = (value, memo) => {
  memo.push(value);
  return memo;
};

program
  .usage(`[options] \<file ... or 'glob'\>`)
  .option(`-e, --editorconfig <file>`, `pass .editorconfig (by default it will look in './.editorconfig').\n!Warning! absolute paths are not supported or will break on Windows OS`, checkEditorConfig)
  .option(`-i, --ignores <profile-name or regexp>`, `ignoring profiles. Like ('js-comments'|'java-comments'|'xml-comments'|'html-comments'|...). Defaults are 'js-comments'|'html-comments'`, [`js-comments`, `html-comments`])
  .option(`-j, --json <file>`, `load GLOBs from JSON file. If no input passed, then it tries to find array in package.json`)
  .option(`-x, --exclude <regexp>`, `exclude files by pattern. Default 'normalize.*'`, collect, [`/normalize.*`])
  .option(VERBOSE_KEYS.join(`, `), `verbose output`)
  .parse(process.argv);

const settings = {
  editorconfig: program.editorconfig || checkEditorConfig(DEFAULT_EDITORCONFIG_NAME),
  ignores: program.ignores,
  json: program.json || DEFAULT_JSON_FILENAME,
  exclude: program.exclude || []
};

log.debug(`Using settings: ${inspect(settings, {depth: 2})}`);
log.debug(`Passed args: '${program.args}'`);

let exitCode = 0;

process.on(`beforeExit`, () => {
  process.exit(exitCode);
});

const printReport = function (report) {
  for (const [filename, info] of report) {
    log.error(format(`\nFile: %s`, filename).red.underline);

    for (const [, line] of info) {
      for (const err of line) {
        let type = err.type;

        const warn = type.toLowerCase() === types.WARNING;
        type = warn ? type.red : type.green;

        if (warn) {
          exitCode = 1;
        }

        log.error(format(`Line: %s %s [%s]`, err.line, err.message, type));
      }
    }
  }

};

const validate = (filePath) => {
  log.debug(`Loading ${filePath}...`);

  lstat(filePath, (err, stat) => {
    if (err) {
      throw err;
    }

    if (!(stat.isDirectory())) {
      log.debug(`Validating '${filePath}'...`);
      const validator = new Validator(settings);
      validator.validate(filePath);
      printReport(validator.getInvalidFiles());
    }
  });
};

const excludes = settings.exclude.map((regexp) => {
  return new RegExp(regexp);
});

const onFile = function (file) {
  const myPath = file;

  const matches = excludes.some((exclude) => {
    log.debug(`Testing file '${myPath}' on '${exclude.toString()}'`);

    const excluded = exclude.test(myPath);
    if (excluded) {
      log.info(`File: ${myPath} [${`excluded`.green}]`);
    }

    return excluded;
  });

  if (!matches) {
    validate(myPath);
  }
};

const processInput = function (args) {
  for (const it of args) {
    const resolved = resolve(it);
    if (resolved) {
      validate(resolved);
    } else {
      log.debug(`Calling GLOB: ${it}`);
      glob(it, {gitignore: true})
        .then(
            (files) => {
              files.forEach(onFile);
            },
            (err) => {
              throw err;
            }
        );
    }
  }
};

const args = Array.isArray(program.args) ? program.args : [program.args];
if (args.length === 0) {
  const found = resolve(settings.json);
  readFile(found, `utf8`, (err, data) => {
    log.debug(`Reading GLOBs from file: '${found}...`);
    try {
      if (err) {
        throw err;
      }

      const patterns = JSON.parse(data)[JSON_CONFIG_PROPERTY_NAME];
      if (!patterns || patterns.length === 0) {
        log.info(`Nothing to do =(`);
        program.help();
      } else {
        log.info(`Loaded GLOBs from '${found}': ${patterns}`);
        processInput(patterns);
      }
    } catch (e) {
      log.error(`Failed to read JSON file: ${e}`.red);
    }
  });
} else {
  processInput(args);
}
