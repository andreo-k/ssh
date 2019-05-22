import {PassThrough} from "stream";
import {PromisifiedReadable} from "./utils";
import * as Q from "q";
import * as _ from "lodash";
import * as stream from "stream";

export abstract class  Interceptor {

    public readonly input: PassThrough = new PassThrough();
    protected promIn: PromisifiedReadable = new PromisifiedReadable(this.input);
    public readonly remoteInput: PassThrough = new PassThrough();

    public readonly remoteOutput: PassThrough = new PassThrough();
    protected promRemoteOut: PromisifiedReadable = new PromisifiedReadable(this.remoteOutput, 'remoteOutput');
    public readonly output: PassThrough = new PassThrough();


    constructor() {
    }

    abstract async work(): Promise<void>;

    isActive: boolean;

    private async emitTo(to: PassThrough, line: string) {
        await Q.nbind(to.write, to)(Buffer.from(`${line}\n`, "utf-8"));
    }

    protected async emitRemoteInput(line: string) {
        await this.emitTo(this.remoteInput, line);
        //await this.expectFrom(this.promRemoteOut);//echoing
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
            console.log(`expectFrom read chunk of ${chunk.length} bytes. line is ${line}`);
            if (_.last(str) === '\n' || _.last(str) === '\r') {
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

var totalRemoteOutBytes = 0;

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
        totalRemoteOutBytes += chunk.length;
        console.log(`from remote output. len=${chunk.length} total=${totalRemoteOutBytes}`);//content=${chunk.toString('utf-8')}
        for (let i of this.interceptors) {
            console.log(`write to remote output`);
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
