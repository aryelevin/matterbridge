/* eslint-disable no-console */
// Home.js
import React, { useEffect, useState, useRef, useContext, useMemo } from 'react';
import { StatusIndicator } from './StatusIndicator';
import { sendCommandToMatterbridge } from './sendApiCommand';
import WebSocketLogs from './WebSocketLogs';
import { WebSocketContext } from './WebSocketProvider';
import Connecting from './Connecting';
import { OnlineContext } from './OnlineProvider';
import { SystemInfoTable } from './SystemInfoTable';
import { MatterbridgeInfoTable } from './MatterbridgeInfoTable';
import { ConfirmCancelForm } from './ConfirmCancelForm';
import { configUiSchema, ArrayFieldTemplate, ObjectFieldTemplate, RemoveButton, CheckboxWidget, createConfigTheme, DescriptionFieldTemplate } from './configEditor';
import { getCssVariable } from './muiTheme';

// @mui
import { Dialog, DialogTitle, DialogContent, TextField, Alert, Snackbar, Tooltip, IconButton, Button, MenuItem, Menu, ThemeProvider } from '@mui/material';
import { DeleteForever, Download, Add, PublishedWithChanges, Settings, Favorite, Help, Announcement, QrCode2, MoreVert, Unpublished } from '@mui/icons-material';

// @rjsf
import Form from '@rjsf/mui';
import validator from '@rjsf/validator-ajv8';

// QRCode
import { QRCodeSVG} from 'qrcode.react';

function Home() {
  const [qrCode, setQrCode] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [systemInfo, setSystemInfo] = useState({});
  const [matterbridgeInfo, setMatterbridgeInfo] = useState({});
  const [plugins, setPlugins] = useState([]);
  const [selectedRow, setSelectedRow] = useState(-1); // -1 no selection, 0 or greater for selected row
  const [selectedPluginName, setSelectedPluginName] = useState('none'); // -1 no selection, 0 or greater for selected row
  const [selectedPluginConfig, setSelectedPluginConfig] = useState({}); 
  const [selectedPluginSchema, setSelectedPluginSchema] = useState({}); 
  const [openSnack, setOpenSnack] = useState(false);
  const [openConfig, setOpenConfig] = useState(false);
  const [logFilterLevel, setLogFilterLevel] = useState(localStorage.getItem('logFilterLevel')??'info');
  const [logFilterSearch, setLogFilterSearch] = useState(localStorage.getItem('logFilterSearch')??'*');

  const { logMessage } = useContext(WebSocketContext);
  const { online } = useContext(OnlineContext);

  const refAddRemove = useRef(null);
  const refRegisteredPlugins = useRef(null);

  const handleSnackOpen = () => {
    setOpenSnack(true);
  };

  const handleSnackClose = (event, reason) => {
    if (reason === 'clickaway') return;
    setOpenSnack(false);
  };

  const handleOpenConfig = () => {
    setOpenConfig(true);
  };

  const handleCloseConfig = () => {
    setOpenConfig(false);
    handleSnackOpen();
    setTimeout(() => {
      reloadSettings();
    }, 1000);
  };

  const columns = React.useMemo( () => [
      { Header: 'Name', accessor: 'name' },
      { Header: 'Description', accessor: 'description' },
      { Header: 'Version', accessor: 'version' },
      { Header: 'Author', accessor: 'author' },
      { Header: 'Type', accessor: 'type' },
      { Header: 'Devices', accessor: 'devices'},
      { Header: 'Tools', accessor: 'qrcode' },
      { Header: 'Status', accessor: 'status'},
    ],
    []
  );

  const fetchSettings = () => {
    // console.log('From home fetchSettings');

    fetch('./api/settings')
      .then(response => response.json())
      .then(data => { 
        // console.log('From home /api/settings:', data); 
        if(data.matterbridgeInformation.bridgeMode==='bridge') {
          setQrCode(data.matterbridgeInformation.matterbridgeQrPairingCode); 
          setPairingCode(data.matterbridgeInformation.matterbridgeManualPairingCode);
        }
        setSystemInfo(data.systemInformation);
        setMatterbridgeInfo(data.matterbridgeInformation);
      })
      .catch(error => console.error('Error fetching settings:', error));

    fetch('./api/plugins')
      .then(response => response.json())
      .then(data => { 
        // console.log('From home /api/plugins:', data)
        setPlugins(data); 
      })
      .catch(error => console.error('Error fetching plugins:', error));
  };  

  useEffect(() => {
    // Call fetchSettings immediately and then every 1 minute
    fetchSettings();
    const intervalId = setInterval(fetchSettings, 1 * 60 * 1000);
  
    // Clear the interval when the component is unmounted
    return () => clearInterval(intervalId);

  }, []);

  // Function to reload settings on demand
  const reloadSettings = () => {
    fetchSettings();
    // console.log('reloadSettings');
  };

  const handleSelectQRCode = (row) => {
    if (selectedRow === row) {
      setSelectedRow(-1);
      setSelectedPluginName('none');
      setQrCode('');
      setPairingCode('');
    } else {
      reloadSettings();
      setSelectedRow(row);
      setSelectedPluginName(plugins[row].name);
      setQrCode(plugins[row].qrPairingCode);
      setPairingCode(plugins[row].manualPairingCode);
    }
    // console.log('Selected row:', row, 'plugin:', plugins[row].name, 'qrcode:', plugins[row].qrPairingCode);
  };

  const handleEnableDisablePlugin = (row) => {
    // console.log('Selected row:', row, 'plugin:', plugins[row].name, 'enabled:', plugins[row].enabled);
    if(plugins[row].enabled===true) {
      plugins[row].enabled=false;
      logMessage('Plugins', `Disabling plugin: ${plugins[row].name}`);
      sendCommandToMatterbridge('disableplugin', plugins[row].name);
    }
    else {
      plugins[row].enabled=true;
      logMessage('Plugins', `Enabling plugin: ${plugins[row].name}`);
      sendCommandToMatterbridge('enableplugin', plugins[row].name);
    }
    if(matterbridgeInfo.bridgeMode === 'childbridge') {
      setTimeout(() => {
        reloadSettings();
      }, 500);
    }
    if(matterbridgeInfo.bridgeMode === 'bridge') {
      setTimeout(() => {
        reloadSettings();
      }, 500);
    }
  };

  const handleUpdatePlugin = (row) => {
    // console.log('handleUpdate row:', row, 'plugin:', plugins[row].name);
    logMessage('Plugins', `Updating plugin: ${plugins[row].name}`);
    sendCommandToMatterbridge('installplugin', plugins[row].name);
    handleSnackOpen({ vertical: 'bottom', horizontal: 'right' });
    setTimeout(() => {
      handleSnackClose();
      reloadSettings();
    }, 5000);
  };

  const handleRemovePlugin = (row) => {
    // console.log('handleRemovePluginClick row:', row, 'plugin:', plugins[row].name);
    logMessage('Plugins', `Removing plugin: ${plugins[row].name}`);
    sendCommandToMatterbridge('removeplugin', plugins[row].name);
    setTimeout(() => {
      reloadSettings();
    }, 500);
  };

  const handleConfigPlugin = (row) => {
    // console.log('handleConfigPlugin row:', row, 'plugin:', plugins[row].name);
    setSelectedPluginConfig(plugins[row].configJson);
    setSelectedPluginSchema(plugins[row].schemaJson);
    handleOpenConfig();
  };

  const handleSponsorPlugin = () => {
    // console.log('handleSponsorPlugin row:', row, 'plugin:', plugins[row].name);
    window.open('https://www.buymeacoffee.com/luligugithub', '_blank');
  };

  const handleHelpPlugin = (row) => {
    // console.log('handleHelpPlugin row:', row, 'plugin:', plugins[row].name);
    window.open(`https://github.com/Luligu/${plugins[row].name}/blob/main/README.md`, '_blank');
  };

  const handleChangelogPlugin = (row) => {
    // console.log('handleChangelogPlugin row:', row, 'plugin:', plugins[row].name);
    window.open(`https://github.com/Luligu/${plugins[row].name}/blob/main/CHANGELOG.md`, '_blank');
  };

  const [showConfirmCancelForm, setShowConfirmCancelForm] = useState(false);
  const [confirmCancelFormTitle, setConfirmCancelFormTitle] = useState('');
  const [confirmCancelFormMessage, setConfirmCancelFormMessage] = useState('');
  const [confirmCancelFormCommand, setConfirmCancelFormCommand] = useState('');
  const [confirmCancelFormRow, setConfirmCancelFormRow] = useState(-1);

  const handleActionWithConfirmCancel = (title, message, command, index) => {
    setConfirmCancelFormTitle(title);
    setConfirmCancelFormMessage(message);
    setConfirmCancelFormCommand(command);
    setConfirmCancelFormRow(index);
    setShowConfirmCancelForm(true);
  };

  const handleConfirm = () => {
    // console.log(`Action confirmed ${confirmCancelFormCommand} ${confirmCancelFormRow}`);
    setShowConfirmCancelForm(false);
    if(confirmCancelFormCommand === 'remove' && confirmCancelFormRow !== -1) {
      handleRemovePlugin(confirmCancelFormRow);
    } else if(confirmCancelFormCommand === 'disable' && confirmCancelFormRow !== -1) {
      handleEnableDisablePlugin(confirmCancelFormRow);
    }
  };

  const handleCancel = () => {
    // console.log("Action canceled");
    setShowConfirmCancelForm(false);
  };

  if (!online) {
    return ( <Connecting /> );
  }
  return (
    <div className="MbfPageDiv" style={{ flexDirection: 'row' }}>
      <Dialog 
        open={openConfig} 
        onClose={handleCloseConfig} 
        maxWidth='800px' 
        PaperProps={{style: { 
          color: 'var(--div-text-color)', 
          backgroundColor: 'var(--div-bg-color)', 
          border: "2px solid var(--div-border-color)", 
          borderRadius: 'var(--div-border-radius)', 
          boxShadow: '2px 2px 5px var(--div-shadow-color)'}}}>
        <DialogTitle gap={'20px'}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '20px' }}>
            <img src="matterbridge 64x64.png" alt="Matterbridge Logo" style={{ height: '64px', width: '64px' }} />
            <h3>Matterbridge plugin configuration</h3>
          </div>
        </DialogTitle>
        <DialogContent style={{ padding: '0px', margin: '0px' }}>
          <DialogConfigPlugin config={selectedPluginConfig} schema={selectedPluginSchema} handleCloseConfig={handleCloseConfig}/>
        </DialogContent>
      </Dialog>

      <ConfirmCancelForm open={showConfirmCancelForm} title={confirmCancelFormTitle} message={confirmCancelFormMessage} onConfirm={handleConfirm} onCancel={handleCancel} />

      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '302px', minWidth: '302px', gap: '20px' }}>
        <QRDiv qrText={qrCode} pairingText={pairingCode} qrWidth={256} topText="QR pairing code" bottomText={selectedPluginName==='none'?'Matterbridge':selectedPluginName} matterbridgeInfo={matterbridgeInfo} plugin={selectedRow===-1?undefined:plugins[selectedRow]}/>
        {systemInfo && <SystemInfoTable systemInfo={systemInfo} compact={true}/>}
        {qrCode==='' && matterbridgeInfo && <MatterbridgeInfoTable matterbridgeInfo={matterbridgeInfo}/>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', gap: '20px' }}>

        {matterbridgeInfo && !matterbridgeInfo.readOnly &&
          <div className="MbfWindowDiv" style={{ flex: '0 0 auto', width: '100%', overflow: 'hidden' }}>
            <div className="MbfWindowHeader">
              <p className="MbfWindowHeaderText">Install add plugin</p>
            </div>
            <AddRemovePlugins ref={refAddRemove} plugins={plugins} reloadSettings={reloadSettings}/>
          </div>
        }

        <div className="MbfWindowDiv" style={{ flex: '0 0 auto', width: '100%', overflow: 'hidden' }}>
          <div className="MbfWindowDivTable" style={{ flex: '0 0 auto', overflow: 'hidden' }}>
            <table ref={refRegisteredPlugins}>
              <thead>
                <tr>
                  <th colSpan="8">Registered plugins</th>
                </tr>
                <tr>
                  {columns.map((column, index) => (
                    <th key={index}>{column.Header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plugins.map((plugin, index) => (

                  <tr key={index} className={selectedRow === index ? 'table-content-selected' : index % 2 === 0 ? 'table-content-even' : 'table-content-odd'}>

                    <td><Tooltip title={plugin.path}>{plugin.name}</Tooltip></td>
                    <td>{plugin.description}</td>

                    {plugin.latestVersion === undefined || plugin.latestVersion === plugin.version || (matterbridgeInfo && matterbridgeInfo.readOnly) ?
                      <td><Tooltip title="Plugin version">{plugin.version}</Tooltip></td> :
                      <td><Tooltip title="New plugin version available, click to install"><span className="status-warning" onClick={() => handleUpdatePlugin(index)}>Update v.{plugin.version} to v.{plugin.latestVersion}</span></Tooltip></td>
                    }
                    <td>{plugin.author.replace('https://github.com/', '')}</td>

                    <td>{plugin.type === 'DynamicPlatform'?'Dynamic':'Accessory'}</td>
                    <td>{plugin.registeredDevices}</td>
                    <td>  
                      <>
                        {matterbridgeInfo && matterbridgeInfo.bridgeMode === 'childbridge' && !plugin.error && plugin.enabled ? <Tooltip title="Shows the QRCode or the fabrics"><IconButton style={{padding: 0}} className="PluginsIconButton" onClick={() => handleSelectQRCode(index)} size="small"><QrCode2 /></IconButton></Tooltip> : <></>}
                        <Tooltip title="Plugin config"><IconButton style={{padding: 0}} className="PluginsIconButton" onClick={() => handleConfigPlugin(index)} size="small"><Settings /></IconButton></Tooltip>
                        {matterbridgeInfo && !matterbridgeInfo.readOnly &&                        
                          <Tooltip title="Remove the plugin"><IconButton style={{padding: 0}} className="PluginsIconButton" onClick={() => { handleActionWithConfirmCancel('Remove plugin', 'Are you sure? This will remove also all the devices and configuration in the controller.', 'remove', index); } } size="small"><DeleteForever /></IconButton></Tooltip>
                        }  
                        {plugin.enabled ? <Tooltip title="Disable the plugin"><IconButton style={{padding: 0}} className="PluginsIconButton" onClick={() => { handleActionWithConfirmCancel('Disable plugin', 'Are you sure? This will remove also all the devices and configuration in the controller.', 'disable', index); } } size="small"><Unpublished /></IconButton></Tooltip> : <></>}
                        {!plugin.enabled ? <Tooltip title="Enable the plugin"><IconButton style={{padding: 0}} className="PluginsIconButton" onClick={() => handleEnableDisablePlugin(index) } size="small"><PublishedWithChanges /></IconButton></Tooltip> : <></>}
                        <Tooltip title="Plugin help"><IconButton style={{padding: 0}} className="PluginsIconButton" onClick={() => handleHelpPlugin(index)} size="small"><Help /></IconButton></Tooltip>
                        <Tooltip title="Plugin version history"><IconButton style={{padding: 0}} className="PluginsIconButton" onClick={() => handleChangelogPlugin(index)} size="small"><Announcement /></IconButton></Tooltip>
                        {matterbridgeInfo && !matterbridgeInfo.readOnly &&                        
                          <Tooltip title="Sponsor the plugin"><IconButton style={{padding: 0, color: '#b6409c'}} className="PluginsIconButton" onClick={() => handleSponsorPlugin(index)} size="small"><Favorite /></IconButton></Tooltip>
                        }
                      </>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'row', flex: '1 1 auto', gap: '5px' }}>

                        <Snackbar anchorOrigin={{vertical: 'bottom', horizontal: 'right'}} open={openSnack} onClose={handleSnackClose} autoHideDuration={10000}>
                          <Alert onClose={handleSnackClose} severity="info" variant="filled" sx={{ width: '100%', bgcolor: '#4CAF50' }}>Restart needed!</Alert>
                        </Snackbar>
                        {plugin.error ? 
                          <>
                            <StatusIndicator status={false} enabledText='Error' disabledText='Error' tooltipText='The plugin is in error state. Check the log!'/></> :
                          <>
                            {plugin.enabled === false ?
                              <>
                                <StatusIndicator status={plugin.enabled} enabledText='Enabled' disabledText='Disabled' tooltipText='Whether the plugin is enable or disabled'/></> :
                              <>
                                {plugin.loaded && plugin.started && plugin.configured && plugin.paired && plugin.connected ? 
                                  <>
                                    <StatusIndicator status={plugin.loaded} enabledText='Running' tooltipText='Whether the plugin is running'/></> : 
                                  <>
                                    {plugin.loaded && plugin.started && plugin.configured && plugin.connected===undefined ? 
                                      <>
                                        <StatusIndicator status={plugin.loaded} enabledText='Running' tooltipText='Whether the plugin is running'/></> : 
                                      <>
                                        <StatusIndicator status={plugin.enabled} enabledText='Enabled' disabledText='Disabled' tooltipText='Whether the plugin is enable or disabled'/>
                                        <StatusIndicator status={plugin.loaded} enabledText='Loaded' tooltipText='Whether the plugin has been loaded'/>
                                        <StatusIndicator status={plugin.started} enabledText='Started' tooltipText='Whether the plugin started'/>
                                        <StatusIndicator status={plugin.configured} enabledText='Configured' tooltipText='Whether the plugin has been configured'/>
                                        {matterbridgeInfo && matterbridgeInfo.bridgeMode === 'childbridge' ? <StatusIndicator status={plugin.paired} enabledText='Paired' tooltipText='Whether the plugin has been paired'/> : <></>}
                                        {matterbridgeInfo && matterbridgeInfo.bridgeMode === 'childbridge' ? <StatusIndicator status={plugin.connected} enabledText='Connected' tooltipText='Whether the controller connected'/> : <></>}
                                      </>
                                    }
                                  </>
                                }
                              </>
                            }
                          </>
                        }
                      </div> 
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="MbfWindowDiv" style={{flex: '1 1 auto', width: '100%', overflow: 'hidden'}}>
          <div className="MbfWindowHeader" style={{ flexShrink: 0 }}>
            <p className="MbfWindowHeaderText" style={{ display: 'flex', justifyContent: 'space-between' }}>Logs <span style={{ fontWeight: 'normal', fontSize: '12px',marginTop: '2px' }}>Filter: logger level "{logFilterLevel}" and search "{logFilterSearch}"</span></p>
          </div>
          <div style={{ flex: '1 1 auto', margin: '0px', padding: '10px', overflow: 'auto'}}>
            <WebSocketLogs/>
          </div>
        </div>

      </div>
    </div>
  );
}

function AddRemovePlugins({ reloadSettings }) {
  const [pluginName, setPluginName] = useState('matterbridge-');
  const [open, setSnack] = useState(false);
  const [anchorEl, setAnchorEl] = React.useState(null);
  const { logMessage } = useContext(WebSocketContext);


  const handleSnackClose = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnack(false);
  };

  const handleInstallPluginClick = () => {
    const plugin = pluginName.split('@')[0];
    if(plugin === 'matterbridge')
      logMessage('Matterbridge', `Installing matterbridge package: ${pluginName}`);
    else
      logMessage('Plugins', `Installing plugin: ${pluginName}`);
    sendCommandToMatterbridge('installplugin', pluginName);
    setTimeout(() => {
      reloadSettings();
    }, 5000);
  };

  const handleAddPluginClick = () => {
    logMessage('Plugins', `Adding plugin: ${pluginName}`);
    sendCommandToMatterbridge('addplugin', pluginName);
    setTimeout(() => {
      reloadSettings();
    }, 1000);
  };

  const handleClickVertical = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleCloseMenu = (value) => {
    // console.log('handleCloseMenu:', value);
    if(value !== '') setPluginName(value);
    setAnchorEl(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'row', flex: '1 1 auto', alignItems: 'center', justifyContent: 'space-between', margin: '0px', padding: '10px', gap: '20px' }}>
      <Snackbar anchorOrigin={{vertical: 'bottom', horizontal: 'right'}} open={open} onClose={handleSnackClose} autoHideDuration={5000}>
        <Alert onClose={handleSnackClose} severity="info" variant="filled" sx={{ width: '100%', bgcolor: '#4CAF50' }}>Restart required</Alert>
      </Snackbar>
      <TextField value={pluginName} onChange={(event) => { setPluginName(event.target.value); }} size="small" id="plugin-name" label="Plugin name or plugin path" variant="outlined" fullWidth/>
      <IconButton onClick={handleClickVertical}>
        <MoreVert />
      </IconButton>
      <Menu id="simple-menu" anchorEl={anchorEl} keepMounted open={Boolean(anchorEl)} onClose={() => handleCloseMenu('')} sx={{ '& .MuiPaper-root': { backgroundColor: '#e2e2e2' } }}>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-zigbee2mqtt')}>matterbridge-zigbee2mqtt</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-somfy-tahoma')}>matterbridge-somfy-tahoma</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-shelly')}>matterbridge-shelly</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-hass')}>matterbridge-hass</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-example-accessory-platform')}>matterbridge-example-accessory-platform</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-example-dynamic-platform')}>matterbridge-example-dynamic-platform</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-eve-door')}>matterbridge-eve-door</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-eve-motion')}>matterbridge-eve-motion</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-eve-energy')}>matterbridge-eve-energy</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-eve-weather')}>matterbridge-eve-weather</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-eve-room')}>matterbridge-eve-room</MenuItem>
      </Menu>
      <Tooltip title="Install or update a plugin from npm">
        <Button onClick={handleInstallPluginClick} endIcon={<Download />} style={{ color: 'var(--main-button-color)', backgroundColor: 'var(--main-button-bg-color)', height: '30px', minWidth: '90px' }}> Install</Button>
      </Tooltip>        
      <Tooltip title="Add an installed plugin">
        <Button onClick={handleAddPluginClick} endIcon={<Add />} style={{ color: 'var(--main-button-color)', backgroundColor: 'var(--main-button-bg-color)', height: '30px', minWidth: '90px' }}> Add</Button>
      </Tooltip>        
    </div>
  );
}

function QRDiv({ qrText, pairingText, qrWidth, topText, matterbridgeInfo, plugin }) {
  // console.log('QRDiv:', matterbridgeInfo, plugin);
  if(matterbridgeInfo.bridgeMode === 'bridge' && matterbridgeInfo.matterbridgePaired === true && matterbridgeInfo.matterbridgeFabricInformations && matterbridgeInfo.matterbridgeSessionInformations) {
    // console.log(`QRDiv: ${matterbridgeInfo.matterbridgeFabricInformations.length} fabrics, ${matterbridgeInfo.matterbridgeSessionInformations.length} sessions`);
    return ( 
      <div className="MbfWindowDiv" style={{alignItems: 'center', minWidth: '302px', overflow: 'hidden'}} >
        <div className="MbfWindowHeader">
          <p className="MbfWindowHeaderText" style={{textAlign: 'left', overflow: 'hidden'}}>Paired fabrics</p>
        </div>
        <div className="MbfWindowBodyColumn">
          {matterbridgeInfo.matterbridgeFabricInformations.map((fabric, index) => (
            <div key={index} style={{ margin: '0px', padding: '10px', gap: '0px', color: 'var(--div-text-color)',  backgroundColor: 'var(--div-bg-color)', textAlign: 'left', fontSize: '14px' }}>
                <p className="status-blue" style={{ margin: '0px 10px 10px 10px', fontSize: '14px', padding: 0, color: 'var(--main-button-color)', backgroundColor: 'var(--main-button-bg-color)' }}>Fabric: {fabric.fabricIndex}</p>
                <p style={{ margin: '0px 20px 0px 20px', color: 'var(--div-text-color)'}}>Vendor: {fabric.rootVendorId} {fabric.rootVendorName}</p>
                {fabric.label !== '' && <p style={{ margin: '0px 20px 0px 20px', color: 'var(--div-text-color)'}}>Label: {fabric.label}</p>}
                <p style={{ margin: '0px 20px 0px 20px', color: 'var(--div-text-color)'}}>Active sessions: {matterbridgeInfo.matterbridgeSessionInformations.filter(session => session.fabric.fabricIndex === fabric.fabricIndex).length}</p>
            </div>  
          ))}
        </div>  
      </div>
    );  
  } else if(matterbridgeInfo.bridgeMode === 'childbridge' && plugin && plugin.paired === true && plugin.fabricInformations && plugin.sessionInformations) {
    // console.log(`QRDiv: ${plugin.fabricInformations.length} fabrics, ${plugin.sessionInformations.length} sessions`);
    return ( 
      <div className="MbfWindowDiv" style={{alignItems: 'center', minWidth: '302px', overflow: 'hidden'}} >
        <div className="MbfWindowHeader">
          <p className="MbfWindowHeaderText" style={{textAlign: 'left'}}>Paired fabrics</p>
        </div>
        <div className="MbfWindowBodyColumn">
          {plugin.fabricInformations.map((fabric, index) => (
            <div key={index} style={{ margin: '0px', padding: '10px', gap: '0px', color: 'var(--div-text-color)', backgroundColor: 'var(--div-bg-color)', textAlign: 'left', fontSize: '14px' }}>
                <p className="status-blue" style={{ margin: '0px 10px 10px 10px', fontSize: '14px', padding: 0 }}>Fabric: {fabric.fabricIndex}</p>
                <p style={{ margin: '0px 20px 0px 20px', color: 'var(--div-text-color)' }}>Vendor: {fabric.rootVendorId} {fabric.rootVendorName}</p>
                {fabric.label !== '' && <p style={{ margin: '0px 20px 0px 20px', color: 'var(--div-text-color)' }}>Label: {fabric.label}</p>}
                <p style={{ margin: '0px 20px 0px 20px', color: 'var(--div-text-color)' }}>Active sessions: {plugin.sessionInformations.filter(session => session.fabric.fabricIndex === fabric.fabricIndex).length}</p>
            </div>  
          ))}
        </div>  
      </div>
    );
  } else if(matterbridgeInfo.bridgeMode === 'bridge' && matterbridgeInfo.matterbridgePaired !== true) {
    // console.log(`QRDiv: qrText ${qrText} pairingText ${pairingText}`);
    return (
      <div className="MbfWindowDiv" style={{alignItems: 'center', minWidth: '302px'}}>
        <div className="MbfWindowHeader">
          <p className="MbfWindowHeaderText" style={{textAlign: 'left'}}>{topText}</p>
        </div>
        <QRCodeSVG value={qrText} size={qrWidth} level='M' fgColor={'var(--div-text-color)'} bgColor={'var(--div-bg-color)'} style={{ margin: '20px' }}/>
        <div className="MbfWindowFooter" style={{padding: 0, marginTop: '-5px', height: '30px'}}>
            <p className="MbfWindowFooterText"  style={{ fontSize: '14px' }}>Manual pairing code: {pairingText}</p>
        </div>
      </div>
    );
  } else if(matterbridgeInfo.bridgeMode === 'childbridge' && plugin && plugin.paired !== true) {
    // console.log(`QRDiv: qrText ${qrText} pairingText ${pairingText}`);
    return (
      <div className="MbfWindowDiv" style={{alignItems: 'center', minWidth: '302px'}}>
        <div className="MbfWindowHeader">
          <p className="MbfWindowHeaderText" style={{textAlign: 'left'}}>{topText}</p>
        </div>
        <QRCodeSVG value={qrText} size={qrWidth} level='M' fgColor={'var(--div-text-color)'} bgColor={'var(--div-bg-color)'} style={{ margin: '20px' }}/>
        <div className="MbfWindowFooter" style={{padding: 0, marginTop: '-5px', height: '30px'}}>
            <p className="MbfWindowFooterText"  style={{ fontSize: '14px' }}>Manual pairing code: {pairingText}</p>
        </div>
      </div>
    );
  }
}

function DialogConfigPlugin( { config, schema, handleCloseConfig } ) {
  // console.log('DialogConfigPlugin:', config, schema);

  const handleSaveChanges = ({ formData }) => {
    // console.log('handleSaveChanges:', formData);
    const config = JSON.stringify(formData, null, 2)
    sendCommandToMatterbridge('saveconfig', formData.name, config);
    // Close the dialog
    handleCloseConfig();
  };    

  const primaryColor = useMemo(() => getCssVariable('--primary-color', '#009a00'), []);
  const configTheme = useMemo(() => createConfigTheme(primaryColor), [primaryColor]);

  return (
    <ThemeProvider theme={configTheme}>
      <div style={{ width: '800px', height: '600px', overflow: 'auto' }}>
        <Form 
          schema={schema} 
          formData={config} 
          uiSchema={configUiSchema} 
          validator={validator} 
          widgets={{ CheckboxWidget: CheckboxWidget }} 
          templates={{ ArrayFieldTemplate, ObjectFieldTemplate, DescriptionFieldTemplate, ButtonTemplates: { RemoveButton } }} 
          onSubmit={handleSaveChanges} />
      </div>
    </ThemeProvider>  
  );
}
  
export default Home;
