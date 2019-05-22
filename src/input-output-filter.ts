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
    protected promRemoteOut: PromisifiedReadable = new PromisifiedReadable(this.remoteOutput);
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
        // echoing
        await this.expectRemoteOutputNotEmpty();
    }

    protected async emitOutput(line: string) {
        await this.emitTo(this.output, line);
    }

    private async expectFrom(from: PromisifiedReadable) {
        let line = null;
        while (true) {
            let chunk = await from.read(1);
            if (chunk[0] == 10 || chunk[0] == 13) {
                if (line == null) {
                    return '';
                }
                return line.toString("utf-8");
            }
            line = (line === null) ? chunk : Buffer.concat([line, chunk]);
        }
    }

    protected async expectInput(): Promise<string> {
        return this.expectFrom(this.promIn);
    }

    protected async expectRemoteOutput(): Promise<string> {
        return this.expectFrom(this.promRemoteOut);
    }

    protected async expectRemoteOutputNotEmpty(): Promise<string> {
        while (true) {
            let line = await this.expectFrom(this.promRemoteOut);
            if (_.isEmpty(line))
                continue;
            return line;
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
