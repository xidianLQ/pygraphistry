var _ = require('underscore');
var bunyan = require('bunyan');
var conf = require('./config.js');

const LOG_FILE = conf.get('log.file');
const LOG_LEVEL = conf.get('log.level');
const LOG_SOURCE = conf.get('log.logSource');

function inBrowser() {
    return typeof (window) !== 'undefined' && window.window === window;
}


function BrowserConsoleStream() {
    this.levelToConsole = {
        'trace': 'debug',
        'debug': 'debug',
        'info': 'info',
        'warn': 'warn',
        'error': 'error',
        'fatal': 'error',
    }

    this.fieldsToOmit = [
        'v',
        'name',
        'fileName',
        'pid',
        'hostname',
        'level',
        'module',
        'time',
        'msg'
    ];
}


BrowserConsoleStream.prototype.write = function (rec) {
    const levelName = bunyan.nameFromLevel[rec.level];
    const method = this.levelToConsole[levelName];
    const prunedRec = _.omit(rec, this.fieldsToOmit);

    if (_.isEmpty(prunedRec)) {
        console[method](rec.msg);
    } else if ('err' in prunedRec){
        console[method](rec.err, rec.msg);
    } else {
        console[method](prunedRec, rec.msg);
    }
}



////////////////////////////////////////////////////////////////////////////////
// Parent logger
//
// A global singleton logger that all module-level loggers are children of.
////////////////////////////////////////////////////////////////////////////////

function createServerLogger() {
    //var serializers = _.extend({}, bunyan.stdSerializers, {
        //err: errSerializer
    //});
    var serializers = bunyan.stdSerializers;

    // Always starts with a stream that writes fatal errors to STDERR
    var streams = [];

    if(_.isUndefined(LOG_FILE)) {
        streams = [{ name: 'stdout', stream: process.stdout, level: LOG_LEVEL }];
    } else {
        streams = [
            { name: 'fatal', stream: process.stderr, level: 'fatal' },
            { name: 'logfile', path: LOG_FILE, level: LOG_LEVEL }
        ];
    }

    const logger = bunyan.createLogger({
        src: LOG_SOURCE,
        name: 'graphistry',
        serializers: serializers,
        streams: streams
    });

    //add any additional logging methods here
    logger.die = function(err, msg) {
        logger.fatal(err, msg);
        logger.fatal('Exiting process with return code of 60 due to previous fatal error');
        process.exit(60);
    };

    process.on('SIGUSR2', function () {
        logger.reopenFileStreams();
    });

    return logger;
}

function createClientLogger() {
    return bunyan.createLogger({
        name: 'graphistry',
        streams: [
            {
                level: 'info',
                stream: new BrowserConsoleStream(),
                type: 'raw'
            }
        ]
    });
}

const parentLogger = inBrowser() ? createClientLogger() : createServerLogger();



////////////////////////////////////////////////////////////////////////////////
// Exports
//
// We export functions for creating module-level loggers, setting global metadata, and convienance
// functions for creating error handler functions that log the error and rethrow it.
////////////////////////////////////////////////////////////////////////////////

module.exports = {
    createLogger: function(module, fileName) {
        return (function () {
            var childLogger = parentLogger.child({module: module, fileName:fileName}, true);

            //add any additional logging methods here

            childLogger.die = function childLoggerDie(err, msg) {
                childLogger.fatal(err, msg);
                process.exit(1);
            };

            childLogger.makeQErrorHandler = function childLoggerMakeQErrorHandler(msg) {
                return module.exports.makeQErrorHandler(childLogger, msg);
            };

            childLogger.makeRxErrorHandler = function childLoggerMakeRxErrorHandler(msg) {
                return module.exports.makeRxErrorHandler(childLogger, msg);
            };

            return childLogger;
        })();
    },
};
