import { MercatorCoordinate } from 'maplibre-gl';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as RiverMap } from 'maplibre-gl';
import type { Grid } from './terrain';

/** A real elevated surface, sharing the terrain depth buffer rather than draping on hills. */
export class WaterSurface implements CustomLayerInterface {
  id = 'river-water-surface';
  type = 'custom' as const;
  renderingMode = '3d' as const;
  private map?: RiverMap;
  private gl?: WebGL2RenderingContext;
  private program?: WebGLProgram;
  private buffer?: WebGLBuffer;
  private vao?: WebGLVertexArrayObject;
  private count = 0;
  private origin = [0,0];
  private dirty = false;
  private data = new Float32Array();
  private timer?: ReturnType<typeof setTimeout>;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  exaggeration = 1.5;

  onAdd(map: RiverMap, gl: WebGL2RenderingContext) {
    this.map=map;this.gl=gl;
    const shader=(type:number,source:string)=>{
      const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s) ?? 'Water shader failed');
      return s;
    };
    const vertex=shader(gl.VERTEX_SHADER,`#version 300 es
      precision highp float;
      in vec4 a_water;
      uniform mat4 u_matrix;
      uniform float u_exaggeration;
      out float v_depth; out vec2 v_position;
      void main(){
        gl_Position=u_matrix*vec4(a_water.xy,a_water.z*u_exaggeration,1.0);
        v_depth=a_water.w; v_position=a_water.xy*10000000.0;
      }`);
    const fragment=shader(gl.FRAGMENT_SHADER,`#version 300 es
      precision highp float;
      in float v_depth; in vec2 v_position;
      uniform float u_time;
      out vec4 color;
      void main(){
        float deep=1.0-exp(-max(v_depth,0.0)*0.19);
        vec3 water=mix(vec3(0.10,0.64,0.78),vec3(0.025,0.16,0.38),deep);
        float ripple=sin(v_position.x*.8+v_position.y*.45-u_time*.85)
                    *sin(v_position.y*1.6-u_time*.55);
        water+=vec3(.025,.045,.05)*ripple*smoothstep(.05,.8,v_depth);
        float alpha=mix(.48,.87,deep);
        color=vec4(water*alpha,alpha);
      }`);
    this.program=gl.createProgram()!;gl.attachShader(this.program,vertex);gl.attachShader(this.program,fragment);gl.linkProgram(this.program);
    gl.deleteShader(vertex);gl.deleteShader(fragment);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error('Could not link water surface');
    this.buffer=gl.createBuffer()!;this.vao=gl.createVertexArray()!;
    const previousVao=gl.getParameter(gl.VERTEX_ARRAY_BINDING), previousBuffer=gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    const location=gl.getAttribLocation(this.program,'a_water');
    gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,4,gl.FLOAT,false,16,0);
    gl.bindVertexArray(previousVao);gl.bindBuffer(gl.ARRAY_BUFFER,previousBuffer);
  }

  setSurface(grid: Grid | null, surface: Float32Array<ArrayBufferLike> = new Float32Array()) {
    if(!grid){this.count=0;this.map?.triggerRepaint();return;}
    const origin=MercatorCoordinate.fromLngLat([grid.west,grid.south]);
    this.origin=[origin.x,origin.y];
    const units=origin.meterInMercatorCoordinateUnits();
    this.data=new Float32Array(surface.length);
    // Keep vertex positions close to zero to avoid world-coordinate float jitter.
    const xs=Array.from({length:grid.size},(_,c)=>MercatorCoordinate.fromLngLat([grid.west+(c+.5)*grid.dx,grid.south]).x-origin.x);
    const ys=Array.from({length:grid.size},(_,r)=>MercatorCoordinate.fromLngLat([grid.west,grid.south+(r+.5)*grid.dy]).y-origin.y);
    for(let i=0;i<surface.length;i+=4){
      const col=surface[i],row=surface[i+1],c=Math.min(grid.size-2,Math.floor(col)),r=Math.min(grid.size-2,Math.floor(row));
      this.data[i]=xs[c]+(xs[c+1]-xs[c])*(col-c);
      this.data[i+1]=ys[r]+(ys[r+1]-ys[r])*(row-r);
      this.data[i+2]=(surface[i+2]+.12)*units;
      this.data[i+3]=surface[i+3];
    }
    this.count=surface.length/4;this.dirty=true;this.map?.triggerRepaint();
  }

  render(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    if(!this.count||!this.program||!this.vao||!this.buffer)return;
    const matrix=Array.from(input.defaultProjectionData.mainMatrix);
    for(let r=0;r<4;r++)matrix[12+r]+=matrix[r]*this.origin[0]+matrix[4+r]*this.origin[1];
    const saved={program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),
      buffer:gl.getParameter(gl.ARRAY_BUFFER_BINDING),depth:gl.isEnabled(gl.DEPTH_TEST),
      cull:gl.isEnabled(gl.CULL_FACE),stencil:gl.isEnabled(gl.STENCIL_TEST),blend:gl.isEnabled(gl.BLEND),
      depthMask:gl.getParameter(gl.DEPTH_WRITEMASK),depthFunc:gl.getParameter(gl.DEPTH_FUNC),
      srcRgb:gl.getParameter(gl.BLEND_SRC_RGB),dstRgb:gl.getParameter(gl.BLEND_DST_RGB),
      srcAlpha:gl.getParameter(gl.BLEND_SRC_ALPHA),dstAlpha:gl.getParameter(gl.BLEND_DST_ALPHA)};
    gl.useProgram(this.program);gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    if(this.dirty){gl.bufferData(gl.ARRAY_BUFFER,this.data,gl.DYNAMIC_DRAW);this.dirty=false;}
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program,'u_matrix'),false,new Float32Array(matrix));
    gl.uniform1f(gl.getUniformLocation(this.program,'u_exaggeration'),this.exaggeration);
    gl.uniform1f(gl.getUniformLocation(this.program,'u_time'),this.reducedMotion.matches?0:performance.now()/1000);
    gl.disable(gl.CULL_FACE);gl.disable(gl.STENCIL_TEST);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES,0,this.count);
    gl.depthMask(saved.depthMask);gl.depthFunc(saved.depthFunc);
    for(const [cap,enabled] of [[gl.CULL_FACE,saved.cull],[gl.STENCIL_TEST,saved.stencil],[gl.DEPTH_TEST,saved.depth],[gl.BLEND,saved.blend]] as const)
      enabled?gl.enable(cap):gl.disable(cap);
    gl.blendFuncSeparate(saved.srcRgb,saved.dstRgb,saved.srcAlpha,saved.dstAlpha);
    gl.bindVertexArray(saved.vao);gl.bindBuffer(gl.ARRAY_BUFFER,saved.buffer);gl.useProgram(saved.program);
    if(!this.reducedMotion.matches&&!this.timer)this.timer=setTimeout(()=>{this.timer=undefined;this.map?.triggerRepaint();},50);
  }

  onRemove() {
    if(this.timer)clearTimeout(this.timer);
    if(this.gl){
      if(this.buffer)this.gl.deleteBuffer(this.buffer);
      if(this.vao)this.gl.deleteVertexArray(this.vao);
      if(this.program)this.gl.deleteProgram(this.program);
    }
    this.map=undefined;
  }
}
