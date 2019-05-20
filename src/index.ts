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
    protected in: PromisifiedReadable = new PromisifiedReadable(this.input);

    constructor() {
    }

    abstract async work(): Promise<void>;

    isActive: boolean;

    protected async emitOutput(line: string) {
        await Q.nbind(this.output.write, this.output)(new Buffer(`${line}\n`, "utf-8"));
    }

    protected async expectInput(): Promise<string> {
        let line = '';
        while (true) {
            let chunk = await this.in.read();
            // @ts-ignore
            let str = Buffer.from(chunk).toString("utf-8");
            line += str;
            if (_.last(str) === '\n') {
                return line;
            }
        }
    }
}



export class GetCommandInterceptor extends Interceptor {

    private buf = '';

    private active = false;

    constructor() {
        super();
    }

    public get isActive() {
        return this.active;
    }


    private async executeCommand(filename: string) {
        //obtain file size
        await this.emitOutput(`ls -l ${filename} | awk '{print $5;}'`);


        //this.active = false;
    }

    async work() {

        while (true) {
            let line = await this.expectInput();

            let command = line.match(/get (.*)/);
            if (command) {

                this.active = true;
                await this.executeCommand(command[1]);
            }
            this.buf = '';
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