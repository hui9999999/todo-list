'use strict';
// Isolated acceptance runs approve pairing without prompting the operator.
const {app,dialog}=require('electron');
if(!process.env.XIAOQI_TEST_DATA)throw new Error('An isolated profile is required');
app.cloudSyncDialogs=[];
dialog.showMessageBox=async(...args)=>{const options=args.at(-1);app.cloudSyncDialogs.push({type:options.type,title:options.title});return {response:0,checkboxChecked:false};};
require('../../main.cjs');
