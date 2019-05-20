import * as yargs from 'yargs';
import * as _ from 'lodash';
import SSH2Promise = require('ssh2-promise');
import * as stream from 'stream';

interface  Interceptor {
    read(chunk: any, encoding: string, cb: Function): void;

    isActive: boolean;
}

export class GetCommandInterceptor implements Interceptor{

    private buf = '';

    read(chunk: any, encoding: string, cb: Function): void {

    }
}


export class TransformInput extends stream.Transform {

    private buf = '';

    constructor() {
        super({objectMode: true});
    }

    _transform(chunk: any, encoding: string, cb: Function) {

        let str = new Buffer(chunk).toString(encoding);

        this.buf += str;

        if (_.last(str) === '\n') {
            let command = this.buf.match(/get (.*)/);
            if (command) {
                this.buf = `cat ${command[1]}\n`;
            }
            this.push(new Buffer(this.buf, encoding), encoding);
            this.buf = '';
        }

        cb();

    }

}

export class TransformOutput extends stream.Transform {

    private buf = '';

    constructor() {
        super({objectMode: true});
    }

    _transform(chunk: any, encoding: string, cb: Function) {

        let str = new Buffer(chunk).toString(encoding);

        this.buf += str;

        if (_.last(str) === '\n') {
            let command = this.buf.match(/get (.*)/);
            if (command) {
                this.buf = `cat ${command[1]}\n`;
            }
            this.push(new Buffer(this.buf, encoding), encoding);
            this.buf = '';
        }

        cb();

    }

}


async function main() {
    try {

        let arg = _.get(yargs.argv, '_[0]');

        if (_.isEmpty(arg)) {
            console.error(`Missing argument. Example: node ssh user:password@host[:port]`);
            process.exit(1);
        }

        let argParsed = arg.match(/([^:]+):([^@]+)@([^:]+)(:(\d+))?/i);

        if (!argParsed) {
            console.error(`Wrong argument. Example: node ssh user:password@host[:port]`);
            process.exit(1);
        }

        var sshconfig = {
            host: argParsed[3],
            port: argParsed[5],
            username: argParsed[1],
            password: argParsed[2]
        }

        var ssh = new SSH2Promise(sshconfig);

        await ssh.connect();

        console.log('established');

        let chan = await ssh.shell();

        chan.stdout.pipe(process.stdout);
        chan.stderr.pipe(process.stderr);
        process.stdin
            .pipe(new TransformInput())
            .pipe(chan.stdout);

        //process.exit(0);
    }
    catch (e) {
        console.error(e);
        process.exit(1);
    }
}

main();