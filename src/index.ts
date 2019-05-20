import * as yargs from 'yargs';
import * as _ from 'lodash';
import SSH2Promise = require('ssh2-promise');
import * as stream from 'stream';
import {PromisifiedReadable} from './utils';
import {PassThrough, Readable} from "stream";
import * as Q from "q";


abstract class  Interceptor {

    public readonly input: PassThrough = new PassThrough();
    public readonly output: PassThrough = new PassThrough();

    constructor() {
    }

    abstract async work(): Promise<void>;

    isActive: boolean;
}



export class GetCommandInterceptor extends Interceptor {

    private buf = '';
    private in: PromisifiedReadable;
    private active = false;

    constructor() {
        super();
        this.in = new PromisifiedReadable(this.input);
    }

    public get isActive() {
        return this.active;
    }

    private async executeCommand() {
        await Q.nbind(this.output.write, this.output)(new Buffer("cat /tmp/server.log\n", "utf-8"));
        //this.active = false;
    }

    async work() {


        while (true) {
            let chunk = await this.in.read();
            // @ts-ignore
            let str = Buffer.from(chunk).toString("utf-8");
            this.buf += str;
            if (_.last(str) === '\n') {
                let command = this.buf.match(/get (.*)/);
                if (command) {
                    //this.buf = `cat ${command[1]}\n`;
                    console.log('command!');
                    this.active = true;
                    await this.executeCommand();
                    //this.active = false;
                }
                this.buf = '';
            }

        }
    }

}


export class InputOutputFilter {

    private inputTransform: stream.Transform;

    constructor(readonly interceptors: Interceptor[]) {

        for (let i of this.interceptors) {
            this.startInterceptor(i);
        }

        let self = this;
        this.inputTransform = new class extends stream.Transform {
            _transform(chunk: any, encoding: string, cb: Function) {
                self.readChunk(chunk, encoding);
                cb();
            }
        };
    }

    private async startInterceptor(i: Interceptor) {
        i.work();
        while (true) {
            let out = new PromisifiedReadable(i.output);
            let buf = await out.read();
            this.inputTransform.push(buf, "utf-8");
        }
    }

    private readChunk(chunk: any, encoding: string) {
        for (let i of this.interceptors) {
            i.input.write(chunk, encoding);
        }

        setImmediate(() => {
            let haveActive = false;
            for (let i of this.interceptors) {
                if (i.isActive) {
                    haveActive = true;
                    break;
                }
            }
            if (!haveActive) {
                this.inputTransform.push(chunk, encoding);
            }
        })

    }

    public filterInput(input: any): any {
        let self = this;
        return input.pipe(this.inputTransform);
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

        console.log('connection established');

        let chan = await ssh.shell();

        chan.stdout.pipe(process.stdout);
        chan.stderr.pipe(process.stderr);

        let filter = new InputOutputFilter([new GetCommandInterceptor()]);
        filter.filterInput(process.stdin).pipe(chan.stdin);

        // process.stdin
        //     //.pipe(new TransformInput())
        //     .pipe(chan.stdin);

        //process.exit(0);
    }
    catch (e) {
        console.error(e);
        process.exit(1);
    }
}

main();