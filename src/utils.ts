import * as stream from "stream";
import * as Q from "q";

export class PromisifiedReadable {

    private s: stream.Readable;
    private readDefer: Q.Deferred<Buffer> | null = null;
    private error: Error | null = null;
    private end_: boolean = false;
    private closed_: boolean = false;

    constructor(s: stream.Readable) {
        this.s = s;
        this.readDefer = Q.defer<Buffer>();

        let self = this;
        s.on('readable', async function (){
            if (self.readDefer) {
                let d = self.readDefer;
                self.readDefer = null;
                d.resolve(s.read());
            }
        });

        s.on('error', function(err){
            self.error = err;
            if (self.readDefer)
                self.readDefer.reject(self.error);

        });

        s.on('end', function(){
            self.end_ = true;
            if (self.readDefer) {
                let d = self.readDefer;
                self.readDefer = null;
                d.resolve(s.read());
            }
        });

        s.on('close', function(){
            self.closed_ = true;
            if (self.readDefer) {
                let d = self.readDefer;
                self.readDefer = null;
                d.resolve(s.read());
            }
        });

    }

    public read(): Q.Promise<Buffer> {
        if (this.error)
            return Q.reject<Buffer>(this.error);

        let buf = this.s.read();

        if (buf || this.end_ || this.closed_) {
            return Q.resolve<Buffer>(buf);
        }

        this.readDefer = Q.defer<Buffer>();

        return this.readDefer.promise;
    }

    public get end(): boolean{
        return this.end_;
    };
    public get closed(): boolean{
        return this.closed_;
    };
}
