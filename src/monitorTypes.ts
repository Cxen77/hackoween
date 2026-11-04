export type AreaMonitor={id:string;name:string;ring:[number,number][];basis:'scenario'|'gauge';threshold:number};
export type MonitorResult={id:string;active:boolean;status:string;height:number|null};
