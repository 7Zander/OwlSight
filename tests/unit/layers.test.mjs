import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLayerViews,componentView} from '../../src/core/views.mjs';
test('layer list collapses RGBA and XYZ but keeps independent data channels',()=>{
 const layers=createLayerViews([{name:'',channels:['beauty.R','beauty.G','beauty.B','beauty.A','normal.X','normal.Y','normal.Z','Depth.Z','ID']}]);
 assert.equal(layers.length,4);assert.deepEqual(layers.map(l=>l.label),['beauty','normal','Depth.Z','ID']);
 assert.deepEqual(componentView(layers[0],'A').components,[3,3,3]);
 assert.equal(componentView(layers[0],'A').color,false);
 assert.equal(componentView(layers[0],'RGBA'),layers[0]);
 assert.equal(componentView(layers[1],'A'),layers[1]);
 assert.equal(componentView(layers[2],'R'),layers[2]);
});
test('RGB layers without alpha keep their composite when A is selected',()=>{
 const [layer]=createLayerViews([{name:'',channels:['R','G','B']}]);
 assert.equal(componentView(layer,'A'),layer);
 assert.deepEqual(componentView(layer,'G').components,[1,1,1]);
});
