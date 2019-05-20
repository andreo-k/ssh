import * as yargs from 'yargs';
import * as _ from 'lodash';
import SSH2Promise = require('ssh2-promise');
import * as stream from 'stream';
import {PromisifiedReadable} from './utils';
import {PassThrough, Readable} from "stream";
import * as Q from "q";
const fs = require('fs');

abstract class  Interceptor {

    public readonly input: PassThrough = new PassThrough();
    protected promIn: PromisifiedReadable = new PromisifiedReadable(this.input);
    public readonly remoteInput: PassThrough = new PassThrough();

    public readonly remoteOutput: PassThrough = new PassThrough();
    protected promRemoteOut: PromisifiedReadable = new PromisifiedReadable(this.remoteOutput);
    public readonly output: PassThrough = new PassThrough();


    constructor() {
    }

    abstract async work(): Promise<void>;

    isActive: boolean;

    private async emitTo(to: PassThrough, line: string) {
        await Q.nbind(to.write, to)(new Buffer(`${line}\n`, "utf-8"));
    }

    protected async emitRemoteInput(line: string) {
        await this.emitTo(this.remoteInput, line);
        await this.expectFrom(this.promRemoteOut);//echoing
    }

    protected async emitOutput(line: string) {
        await this.emitTo(this.output, line);
    }

    private async expectFrom(from: PromisifiedReadable) {
        let line = '';
        while (true) {
            let chunk = await from.read();
            // @ts-ignore
            let str = Buffer.from(chunk).toString("utf-8");
            line += str;
            if (_.last(str) === '\n') {
                return line;
            }
        }
    }

    protected async expectInput(): Promise<string> {
        return this.expectFrom(this.promIn);
    }

    protected async expectRemoteOutput(): Promise<string> {
        return this.expectFrom(this.promRemoteOut);
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


    private async executeCommandInternal(filename: string) {
        //obtain file size
        await this.emitRemoteInput(`ls -l ${filename} | awk '{print $5;}'`);
        let line = await this.expectRemoteOutput();
        let siz = Number.parseInt(line);
        if (Number.isNaN(siz)) {
            await this.emitOutput("Can not find the file");
            return;
        }

        //obtain file content
        await this.emitRemoteInput(`cat ${filename}`);

        var wstream = fs.createWriteStream('output.dat');

        while (siz > 0) {
            let chunk = await this.promRemoteOut.read();
            siz -= (chunk.length);
            console.log(`siz is ${siz}`);
            await Q.nbind(wstream.write, wstream)(Buffer.from(chunk));
        }

        await wstream.close();

        let iii = 123;
        //this.active = false;
    }

    private async executeCommand(filename: string) {
        try {
            await this.executeCommandInternal(filename);
        } catch(e) {
            console.error(e);
        }
        this.active = false;
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
    private outputTransform: stream.Transform;

    constructor(readonly interceptors: Interceptor[]) {

        for (let i of this.interceptors) {
            this.startInterceptor(i);
        }

        let self = this;
        this.inputTransform = new class extends stream.Transform {
            _transform(chunk: any, encoding: string, cb: Function) {
                self.readInputChunk(chunk, encoding);
                cb();
            }
        };
        this.outputTransform = new class extends stream.Transform {
            _transform(chunk: any, encoding: string, cb: Function) {
                self.readOutputChunk(chunk, encoding);
                cb();
            }
        };
    }

    private async startInterceptor(i: Interceptor) {
        i.work();

        (async (i:Interceptor) => {
            let prom = new PromisifiedReadable(i.remoteInput);
            while (true) {
                let buf = await prom.read();
                this.inputTransform.push(buf, "utf-8");
            }
        })(i);

        (async (i:Interceptor) => {
            let prom = new PromisifiedReadable(i.output);
            while (true) {
                let buf = await prom.read();
                this.outputTransform.push(buf, "utf-8");
            }
        })(i);
    }

    private readInputChunk(chunk: any, encoding: string) {
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

    private readOutputChunk(chunk: any, encoding: string) {
        for (let i of this.interceptors) {
            i.remoteOutput.write(chunk, encoding);
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
                this.outputTransform.push(chunk, encoding);
            }
        })
    }

    public filterInput(input: any): any {
        return input.pipe(this.inputTransform);
    }

    public filterOutput(output: any): any {
        return output.pipe(this.outputTransform);
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

        //chan.stdout.pipe(process.stdout);
        chan.stderr.pipe(process.stderr);

        let filter = new InputOutputFilter([new GetCommandInterceptor()]);
        filter.filterInput(process.stdin).pipe(chan.stdin);
        filter.filterOutput(chan.stdout).pipe(process.stdout);

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