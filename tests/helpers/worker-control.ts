import type {WorkerControl} from '../../src/lib/fundamentals/worker-control';
export function memoryControl(rows: Map<string,Record<string,unknown>>,key:string):WorkerControl {
    return {
        read:async()=>structuredClone(rows.get(key)??{}),
        change:async edit=>{
            const {result,next}=edit(structuredClone(rows.get(key)??{}));
            if(next)rows.set(key,next);
            return result;
        },
    };
}
