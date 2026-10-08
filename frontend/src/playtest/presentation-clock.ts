type Scheduler = {set:(callback:()=>void,ms:number)=>unknown;clear:(handle:unknown)=>void};
/** Only presentation waits are interrupted. No queue entries, game requests or decisions live here. */
export class PresentationClock {
  private pending = new Map<()=>void,unknown>();
  private skipping = false;
  private readonly scheduler: Scheduler;
  constructor(scheduler: Scheduler = {set:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id as ReturnType<typeof setTimeout>)}) {this.scheduler=scheduler;}
  get catchingUp() {return this.skipping;}
  wait(ms:number):Promise<void> {
    if(this.skipping || ms<=0) return Promise.resolve();
    return new Promise(resolve=>{
      const finish=()=>{this.pending.delete(finish);resolve();};
      const id=this.scheduler.set(finish,ms);this.pending.set(finish,id);
    });
  }
  catchUp() {
    this.skipping=true;
    for(const [finish,id] of [...this.pending]) {this.scheduler.clear(id);finish();}
  }
  finish() {this.skipping=false;}
}
