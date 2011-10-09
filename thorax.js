var Thorax,
  mode = 0777,
  path = require('path'),
  fs = require('fs'),
  child = require('child_process'),
  handlebars = require('handlebars');

//private methods
var loadGenerators = function() {
    fs.readdirSync(path.join(__dirname, 'generators')).forEach(function(generator_dir) {
      this._generators[path.basename(generator_dir)] = require(path.join(__dirname, 'generators', generator_dir, 'index.js'));
    }, this);
  },

  camelize = function(string) {
    return string.replace (/(?:^|[-_])(\w)/g, function (_, c) {
      return c ? c.toUpperCase () : '';
    });
  },

  cleanFileName = function(name, pattern) {
    if (name.match(pattern)) {
      name = name.replace(pattern, '');
    }
    if (!name.match(/\.(js|coffee)$/)) {
      name = name + this.lumbarJSON.language === 'javascript' ? '.js' : '.coffee';
    }
    return name;
  },

  nameFromFileName = function(file_name) {
    return path.basename(file_name).replace(/\..*$/);
  },

  moduleNameFromArguments = function(args) {
    if (args.length === 1) {
      module_name = args[1].split('/').shift();
    } else {
      module_name = args[0];
    }
    if (!thorax.lumbarJSON.modules[module_name]) {
      thorax.log('error: module ' + module_name ' does not exist');
      console.log(module.exports.help);
      return false;
    }
    return module_name;
  };

//constructor
module.exports = function(target, options) {
  this.generatorName = 'base'; //for thorax.log
  this.loadPrefix = '';
  this.target = target || process.cwd();
  this.project = camelize(path.basename(this.target));
  this._generators = {};
  loadGenerators.call(this);
  this._packageJSONPath = path.join(this.target, 'package.json');
  this._lumbarJSONPath = path.join(this.target, 'lumbar.json');
  if (options && options.create) {
    this.mkdir(null); //creates the project directory
    fs.writeFileSync(this._lumbarJSONPath, '{}');
    fs.writeFileSync(this._packageJSONPath, '{}');
    this.packageJSON = {};
    this.lumbarJSON = {};
  } else {
    try {
      this.packageJSON = JSON.parse(fs.readFileSync(this._packageJSONPath));
      this.lumbarJSON = JSON.parse(fs.readFileSync(this._lumbarJSONPath));
    } catch(e) {
      thorax.log('error: ' + this.target + ' does not appear to be a Thorax project directory');
    }
  }
};

module.exports.help = [
  "Usage:",
  "",
  "Create a new project & directory:",
  "",
  "  thorax init project-name [web|mobile]",
  "",
  "In project directory:",
  "",
  "  thorax install node-module-name",
  "  thorax view [module-name] file-name",
  "  thorax collection-view [module-name] file-name",
  "  thorax model [module-name] file-name",
  "  thorax collection [module-name] file-name",
  "  thorax router name",
  "  thorax module name",
  "  thorax template template",
  "  thorax platform name",
  "  thorax package name"
].join("\n")

//actions
module.exports.actions = {
  init: function(target, generator) {
    var thorax = new module.exports(target, {
      create: true
    });

    var complete = function() {
      thorax.save(function(){
        //empty module name will install from generated package.json
        thorax.npmInstall('',function() {
          thorax.log('init complete');
        });
      });
    };

    thorax.generate('base', function() {
      if (generator) {
        thorax.generate(generator, complete);
      } else {
        complete();
      }
    });
  },

  install: function(module_path) {
    var bits = module_path.split('@'),
      module_name = nameFromFileName(bits[0]),
      version = bits[1] || '*',
      thorax = new module.exports();
    thorax.packageJSON.dependencies[module_name] = version;
    thorax.save(function() {
      thorax.npmInstall(module_path, function(installed_module_path) {
        //after installing the npm package, read the config and:
        // - copy package.main to app/lib if present and package.thorax isn't
        // - execute package.thorax.scripts.install if present
        // - copy package.thorax.files if present
        //module_path will now refer to the local filesystem path, not the supplied argument
        module_path = path.join(thorax.target, installed_module_path);
        try {
          var module_json = JSON.parse(fs.readFileSync(path.join(module_path, 'package.json')));
        } catch(e) {
          thorax.log('invalid npm/thorax module: ' + module_name);
          return;
        }
        if (module_json.main && !module_json.thorax) {
          thorax.copy(path.join(module_path, module_json.main), path.join('app', 'lib', path.basename(module_json.main)));
        }
        if (module_json.thorax) {
          if (module_json.thorax.scripts && module_json.thorax.scripts.install) {
            require(path.join(module_path, module_json.thorax.scripts.install))(thorax);
          }
          if (module_json.thorax.files) {
            module_json.thorax.files.forEach(function(file) {
              thorax.copy(path.join(module_path, file), file);
            });
          }
        }
        thorax.save(function() {
          thorax.log('npm/thorax module install complete');
        });
      });
    });
  },

  view: function(module_name, file_name) {
    var thorax = new module.exports();
    module_name = moduleNameFromArguments.call(thorax, arguments);
    if (module_name) {
      file_name = cleanFileName.call(this, file_name, /^\/?app\/views\/?/);

      var full_path = path.join('app', 'views', file_name),
        engine = thorax.lumbarJSON.templates.engine,
        template_path = path.join(thorax.target, 'generators', 'view.handlebars'),
        view_template_path = path.join('app', 'templates', file_name).replace(/\.(js|coffee)$/, '.' + engine)
      
      thorax.writeFile(full_path, thorax.template(template_path, {
        fileName: full_path,
        moduleName: module_name,
        name: name,
        className: camelize(name)
      }));

      thorax.writeFile(view_template_path, '');
      
      thorax.lumbarJSON.modules[module_name].files.push(full_path);
      thorax.lumbarJSON.templates[full_path] = [view_template_path];
    }
  },

  'collection-view': function(module_name, file_name) {
    var thorax = new module.exports();
    module_name = moduleNameFromArguments.call(thorax, arguments);
    if (module_name) {
      file_name = cleanFileName.call(this, file_name, /^\/?app\/views\/?/);

      var full_path = path.join('app', 'views', file_name),
        engine = thorax.lumbarJSON.templates.engine,
        template_path = path.join(thorax.target, 'generators', 'collection-view.handlebars'),
        view_template_path = path.join('app', 'templates', file_name).replace(/\.(js|coffee)$/, '.' + engine);
      
      //view file
      thorax.writeFile(full_path, thorax.template(template_path, {
        fileName: full_path,
        moduleName: module_name,
        name: name,
        className: camelize(name)
      }));
      thorax.lumbarJSON.modules[module_name].files.push(full_path);

      //templates
      thorax.lumbarJSON.templates[full_path] = [
        view_template_path,
        view_template_path.replace(new RegExp('.' + engine + '$'), '-item.' + engine),
        view_template_path.replace(new RegExp('.' + engine + '$'), '-empty.' + engine)
      ];
      thorax.lumbarJSON.templates[full_path].forEach(function(_view_template_path) {
        thorax.writeFile(_view_template_path, '');
      });
    }
  },

  model: function(module_name, file_name) {
    var thorax = new module.exports();
    module_name = moduleNameFromArguments.call(thorax, arguments);
    if (module_name) {
      file_name = cleanFileName.call(this, file_name, /^\/?app\/models\/?/);

      var full_path = path.join('app', 'models', file_name),
        template_path = path.join(thorax.target, 'generators', 'model.handlebars');

      thorax.writeFile(full_path, thorax.template(template_path, {
        fileName: full_path,
        moduleName: module_name,
        name: name,
        className: camelize(name)
      }));
      thorax.lumbarJSON.modules[module_name].files.push(full_path);
    }
  },

  collection: function(module_name, file_name) {
    var thorax = new module.exports();
    module_name = moduleNameFromArguments.call(thorax, arguments);
    if (module_name) {
      file_name = cleanFileName.call(this, file_name, /^\/?app\/models\/?/);

      var full_path = path.join('app', 'collections', file_name),
        template_path = path.join(thorax.target, 'generators', 'collection.handlebars');

      thorax.writeFile(full_path, thorax.template(template_path, {
        fileName: full_path,
        moduleName: module_name,
        name: name,
        className: camelize(name)
      }));
      thorax.lumbarJSON.modules[module_name].files.push(full_path);
    }
  },

  router: function(file_name) {
    var thorax = new module.exports(),
      name = cleanFileName.call(this, file_name, /^\/?app\/routers\/?/),
      file_name = path.join('app', 'routers', file_name),
      template_path = path.join(thorax.target, 'generators', 'router.handlebars'),
      name = nameFromFileName(file_name),
      template_output = thorax.template(template_path,{
        name: name,
        fileName: file_name,
        name: name,
        className: camelize(name)
      }),
      complete = function() {
        thorax.log('created router:' + file_name);
      };

    thorax.writeFile(file_name, template_output);
    if (!thorax.modules[module_name]) {
      thorax.lumbarJSON.modules[module_name] = {
        routes: {},
        files: []
      };
      thorax.log('created module: ' + module_name);
      thorax.save(complete);
    } else {
      complete();
    }
  },

  template: function(file_name) {
    file_name = cleanFileName.call(this, file_name, /^\/?app\/templates\/?/);
    var thorax = new module.exports();
    thorax.writeFile(path.join('app', 'templates', file_name), '');
    thorax.log('created template: ' + file_name);
  },

  platform: function(name) {
    var thorax = new module.exports();
    thorax.lumbarJSON.modules[name] = {};
    thorax.save(function() {
      thorax.log('created module: ' + name);
    });
  },

  'package': function(name) {
    var thorax = new module.exports();
    thorax.lumbarJSON.packages[name] = {
      platforms: thorax.lumbarJSON.platforms,
      combine: false
    };
    thorax.save(function() {
      thorax.log('created package: ' + name);
    });
  },

  'module': function(name) {
    var thorax = new module.exports();
    thorax.lumbarJSON.modules[name] = {
      routes: {},
      files: []
    };
    thorax.save(function() {
      thorax.log('created module: ' + name);
    });
  }
};

//instance methods
var methods = {
  save: function(next) {
    fs.writeFileSync(this._packageJSONPath, JSON.stringify(this.packageJSON, null, 2));
    fs.writeFileSync(this._lumbarJSONPath, JSON.stringify(this.lumbarJSON, null, 2));
    if (next) {
      next();
    }
  },
  
  log: function(message) {
    console.log('thorax.' + this.generatorName + ': ' + message);
  },
  
  generate: function(generator_name, next) {
    this.generatorName = generator_name;
    this._generators[generator_name](this, next);
  },
  
  mkdir: function(name) {
    fs.mkdirSync((!name ? this.target : path.join(this.target, name)), mode);
  },
  
  copy: function(src, dest) {
    fs.writeFileSync(path.join(this.target, dest), fs.readFileSync(src));
  },
  
  writeFile: function(dest, contents) {
    fs.writeFileSync(path.join(this.target, dest), contents);
  },

  template: function(src, context) {
    var template_src = fs.readFileSync(src),
      template = Handlebars.compile(template_src);
    context = context || {};
    context.project = this.project;
    context.target = this.target;
    context.loadPrefix = this.loadPrefix;
    context.packageJSON = this.packageJSON;
    context.lumbarJSON = this.lumbarJSON;
    return template(context);
  },

  npmInstall: function(module_path, next) {
    var command = module_path === ''
      ? 'cd ' + path.join(process.cwd(), this.target) + '; npm install ' + module_path + '; cd ..;'
      : 'npm install ' + module_path + ';' 
    ;

    child.exec(command,function(error, stdout, stderr) {
      var path;
      if (stdout && stdout !== '') {
        console.log('thorax.npm-install: ' + stdout);
        path = stdout.split(/\n/).shift().replace(/\s$/, '').split(/\s/).pop();
      }
      if (stderr && stderr !== '') {
        console.error('thorax.npm-install error: ' + stderr);
        path = false;
      }
      if (next) {
        next(path);
      }
    });
  }
};

for (var name in methods) {
  module.exports.prototype[name] = methods[name];
}