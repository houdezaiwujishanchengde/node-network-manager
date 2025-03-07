const os = require("os");
const { spawn,exec } = require("child_process");

// collect ip4 addresses using "os" module
const getIPv4 = () =>
  new Promise((resolve, reject) => {
    try {
      const networkInterfaces = os.networkInterfaces();
      let items = [];
      for (const key in networkInterfaces) {
        if (Object.hasOwnProperty.call(networkInterfaces, key)) {
          const element = networkInterfaces[key];
          for (const item of element) {
            if (!item.internal && item.family === "IPv4")
              items.push({
                address: item.address,
                netmask: item.netmask,
                mac: item.mac,
              });
          }
        }
      }
      resolve(items);
    } catch (error) {
      reject(error);
    }
  });

// stringToJson convertor
const stringToJson = (stringData) => {
  const data = stringData
    .toString()
    .split("\n")
    .map((keyVal) => {
      const index = keyVal.indexOf(":");
      const obj = {};
      obj[keyVal.slice(0, index)] = keyVal.slice(index + 1).replace(/^ */, "");
      return obj;
    });
  const firstKey = Object.keys(data[0])[0];
  let i = 1;
  for (i = 1; i < data.length; i++) {
    const element = Object.keys(data[i])[0];
    if (element === firstKey) {
      break;
    }
  }

  let list = [];
  for (let index = 0; index < data.length; index += i) {
    let obj = {};
    data.slice(index, index + i).forEach((item) => {
      const key = Object.keys(item)[0];
      if (key) obj[key] = item[key];
    });
    if (!!Object.keys(obj).length) list.push(obj);
  }

  return list;
};

// nmcli request for single answer or without answer
const cli = (args) =>
  new Promise((resolve, reject) => {
    let resolved = false;
    try {
      const nmcli = spawn("nmcli", args);
      nmcli.stdout.on("data", (data) => {
        if (resolved) return;
        resolved = true;
        resolve(data.toString().trim());
      });
      nmcli.stderr.on("data", (data) => {
        if (resolved) return;
        resolved = true;
        reject(data.toString().trim());
      });
      nmcli.on("close", (code) => {
        if (resolved) return;
        resolved = true;
        resolve(code);
      });
    } catch (err) {
      if (resolved) return;
      resolved = true;
      reject(err);
    }
  });

// nmcli request for multiline answer
const clib = (args) =>
  new Promise((resolve, reject) => {
    let resolved = false;
    try {
      const nmcli = spawn("nmcli", args);
      const body = [];
      nmcli.stdout.on("data", (data) => {
        body.push(data);
      });
      nmcli.stderr.on("data", (data) => {
        if (resolved) return;
        resolved = true;
        reject(data.toString());
      });
      nmcli.on("close", (code) => {
        if (resolved) return;
        resolved = true;
        try {
          if (code !== 0) return reject(code);
          resolve(stringToJson(body.join("")));
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      reject(error);
    }
  });

// activity monitor stream
const activityMonitor = (stream) =>
  new Promise((resolve, reject) => {
    try {
      const nmcli = spawn("nmcli", ["monitor"]);
      nmcli.stdout.pipe(stream, { end: false });

      function endStream() {
        nmcli.kill("SIGHUP");
      }

      resolve(endStream);
    } catch (error) {
      reject(error);
    }
  });

// hostname
const getHostName = () => cli(["general", "hostname"]);
const setHostName = (hostName) =>
  cli(["general", "hostname", String(hostName)]);
// networking
const enable = () => cli(["networking", "on"]);
const disable = () => cli(["networking", "off"]);
const getNetworkConnectivityState = (reChecking = false) =>
  cli(
    reChecking
      ? ["networking", "connectivity", "check"]
      : ["networking", "connectivity"]
  );
// connections (profiles)
const connectionUp = (profile) => cli(["connection", "up", String(profile)]);
const connectionDown = (profile) =>
  cli(["connection", "down", String(profile)]);
const connectionDelete = (profile) =>
  cli(["connection", "delete", String(profile)]);
const getConnectionProfilesList = (active = false) =>
  clib(
    active
      ? [
        "-m",
        "multiline",
        "connection",
        "show",
        "--active",
        "--order",
        "active:name",
      ]
      : ["-m", "multiline", "connection", "show", "--order", "active:name"]
  );
const changeDnsConnection = (profile, dns) =>
  cli(["connection", "modify", String(profile), "ipv4.dns", String(dns)])
const addEthernetConnection = (connection_name, interface = 'enp0s3', ipv4, gateway) =>
  cli([
    "connection",
    "add",
    "type",
    "ethernet",
    "con-name",
    connection_name,
    "ifname",
    interface,
    "ipv4.method",
    "manual",
    "ipv4.addresses",
    `${ipv4}/24`,
    "gw4",
    gateway
  ]);
const addGsmConnection = (connection_name, interface = '*', apn, username, password, pin) => {
  let cmd = [
    "connection",
    "add",
    "type",
    "gsm",
    "con-name",
    connection_name,
    "ifname",
    interface
  ];

  if (apn) {
    cmd.push("apn");
    cmd.push(String(apn));
  }

  if (username) {
    cmd.push("username");
    cmd.push(String(username));
  }

  if (password) {
    cmd.push("password");
    cmd.push(String(password));
  }

  if (pin) {
    cmd.push("pin");
    cmd.push(String(pin));
  }

  return cli(cmd);
};
// devices
const deviceConnect = (device) => cli(["device", "connect", String(device)]);
const deviceDisconnect = (device) =>
  cli(["device", "disconnect", String(device)]);
const deviceStatus = async () => {
  const data = await clib(["device", "status"]);
  return Object.keys(data[0])
    .map((line) => {
      if (line.startsWith("DEVICE")) return null; // filter first line
      const lines = line
        .replaceAll(/\s{2,}/g, " ")
        .trim()
        .split(" ");
      const ret = {};
      ret.device = lines.shift();
      ret.type = lines.shift();
      ret.state = lines.shift();
      ret.connection = lines.join(" ");
      return ret;
    })
    .filter((x) => !!x); // filter first line
};
const getDeviceInfoIPDetail = async (deviceName) => {
  const statesMap = {
    10: "unmanaged",
    30: "disconnected",
    100: "connected",
  };
  const data = await clib(["device", "show", String(deviceName)]);
  return data.map((item) => {
    const state = parseInt(item["GENERAL.STATE"]) || 10; // unmanaged by default
    return {
      device: item["GENERAL.DEVICE"],
      type: item["GENERAL.TYPE"],
      state: statesMap[state],
      connection: item["GENERAL.CONNECTION"],
      mac: item["GENERAL.HWADDR"],
      ipV4: item["IP4.ADDRESS[1]"]?.replace(/\/[0-9]{2}/g, ""),
      netV4: item["IP4.ADDRESS[1]"],
      gatewayV4: item["IP4.GATEWAY"],
      ipV6: item["IP6.ADDRESS[1]"]?.replace(/\/[0-9]{2}/g, ""),
      netV6: item["IP6.ADDRESS[1]"],
      gatewayV6: item["IP6.GATEWAY"],
    };
  })[0];
};

const getAllDeviceInfoIPDetailWithType = async (deviceName) => {
  const statesMap = {
    10: "unmanaged",
    30: "disconnected",
    100: "connected",
  };
  const data = await clib(["device", "show", String(deviceName)]);
  return data.map((item) => {
    const state = parseInt(item["GENERAL.STATE"]) || 10; // unmanaged by default

    const ipV4Addresses = [];
    Object.keys(item).forEach(key => {
      if (key.startsWith("IP4.ADDRESS")) {
        const ip = item[key];
        if (ip) {
          ipV4Addresses.push(ip.replace(/\/[0-9]{2}/g, ""));
        }
      }
    });

    const ipV6Addresses = [];
    Object.keys(item).forEach(key => {
      if (key.startsWith("IP6.ADDRESS")) {
        const ip = item[key];
        if (ip) {
          ipV6Addresses.push(ip.replace(/\/[0-9]{2}/g, ""));
        }
      }
    });

    return {
      device: item["GENERAL.DEVICE"],
      type: item["GENERAL.TYPE"],
      state: statesMap[state],
      connection: item["GENERAL.CONNECTION"],
      mac: item["GENERAL.HWADDR"],
      ipV4: ipV4Addresses,
      netV4: item["IP4.ADDRESS[1]"],
      gatewayV4: item["IP4.GATEWAY"],
      ipV6: ipV6Addresses,
      netV6: item["IP6.ADDRESS[1]"],
      gatewayV6: item["IP6.GATEWAY"],
    };
  });
};

const getAllDeviceInfoIPDetail = async () => {
  const statesMap = {
    10: "unmanaged",
    30: "disconnected",
    100: "connected",
  };
  const data = await clib(["device", "show"]);
  return data.map((item) => {
    const state = parseInt(item["GENERAL.STATE"]) || 10; // unmanaged by default
    return {
      device: item["GENERAL.DEVICE"],
      type: item["GENERAL.TYPE"],
      state: statesMap[state],
      connection: item["GENERAL.CONNECTION"],
      mac: item["GENERAL.HWADDR"],
      ipV4: item["IP4.ADDRESS[1]"]?.replace(/\/[0-9]{2}/g, ""),
      netV4: item["IP4.ADDRESS[1]"],
      gatewayV4: item["IP4.GATEWAY"],
      ipV6: item["IP6.ADDRESS[1]"]?.replace(/\/[0-9]{2}/g, ""),
      netV6: item["IP6.ADDRESS[1]"],
      gatewayV6: item["IP6.GATEWAY"],
    };
  });
};

// wifi
const wifiEnable = () => cli(["radio", "wifi", "on"]);
const wifiDisable = () => cli(["radio", "wifi", "off"]);
const getWifiStatus = () => cli(["radio", "wifi"]);
const wifiHotspot = async (ifname, ssid, password) =>
  clib([
    "device",
    "wifi",
    "hotspot",
    "ifname",
    String(ifname),
    "ssid",
    ssid,
    "password",
    password,
  ]);

const wifiCredentials = async (ifname) => {
  if (!ifname) throw Error("ifname required!");
  const data = await clib([
    "device",
    "wifi",
    "show-password",
    "ifname",
    ifname,
  ]);
  return data[0];
};

const getWifiList = async (reScan = false) => {
  const data = await clib(
    reScan
      ? ["-m", "multiline", "device", "wifi", "list", "--rescan", "yes"]
      : ["-m", "multiline", "device", "wifi", "list", "--rescan", "no"]
  );

  return data.map((el) => {
    let o = Object.assign({}, el);
    o.inUseBoolean = o["IN-USE"] === "*";
    return o;
  });
};

const cliSub = (command) => {
  return new Promise((resolve, reject) => {
    exec(command.join(" "), (error, stdout, stderr) => {
      if (error) {
        reject(stderr || error.message);
      } else {
        resolve(stdout);
      }
    });
  });
};

const wifiConnect = async (profile, ssid, password, hidden = false) => {
  let command = `nmcli connection modify ${profile} 802-11-wireless.ssid '${ssid}' wifi-sec.psk '${password}'`;
  
  if (hidden) {
    command += " 802-11-wireless.hidden yes";
  }
  
  await cliSub([command]);
  return await cliSub(["nmcli connection up", profile]);
};

// Set interface to DHCP
const setDhcpConnection = (profile) => {
  return cli([
    "connection", "modify", String(profile),
    "ipv4.method", "auto",
    "ipv4.addresses", "",
    "ipv4.gateway", "",
    "ipv4.dns", ""
  ]);
};

// Set static IP for a connection profile
const setStaticIpConnection = (profile, ipv4, gateway, mask, dns = []) => {
  // If mask is invalid or not a number, set it to 24
  if (isNaN(mask) || mask < 1 || mask > 32) {
    mask = 24;
  }

  const dnsServers = Array.isArray(dns) 
    ? dns.join(",") 
    : typeof dns === "string" && dns.length > 0 
    ? dns 
    : "";

  const cmd = [
    "connection", "modify", String(profile),
    "ipv4.method", "manual",
    "ipv4.addresses", `${ipv4}/${mask}`,
    "ipv4.gateway", gateway
  ];
  if (dnsServers) {
    cmd.push("ipv4.dns", dnsServers);
  }
  return cli(cmd);
};

// Get DNS settings for a connection profile
const getDnsConnection = async (profile) => {
  const data = await clib(["connection", "show", String(profile)]);
  const dnsEntry = data.find(item => item["IP4.DNS[1]"]);
  return dnsEntry ? dnsEntry["IP4.DNS[1]"] : null;
};

// Get IPv4 configuration method (auto or manual) for a connection profile
const getIPv4ConfigMethod = async (profile) => {
    const data = await clib(["connection", "show", String(profile)]);
    const ipv4Config = data.find(item => item["ipv4.method"]);
    return ipv4Config["ipv4.method"];
};

// Get network device type based on the connection profile using nmcli
const getNetworkDeviceType = async (profile) => {
  const data = await clib(["device"]);
  const devices = Object.values(data[0]).map(value => {
    const parts = value.trim().split(/\s+/);
    return {
      DEVICE: parts[0],
      TYPE: parts[1],
      STATE: parts[2],
      CONNECTION: parts.slice(3).join(" ") 
    };
  });

  const matchedDevice = devices.find(item => item.DEVICE === profile || item.CONNECTION === profile);
  return matchedDevice ? matchedDevice.TYPE : `No device found for profile: ${profile}`;
};

const getWifiInfo = async (profile) => {
  const data = await clib(["device", "wifi", "show"]);
  const wifiInfo = data.find(item => item.SSID === profile); 

  if (!wifiInfo) {
    throw new Error("Wi-Fi profile not found");
  }
  return wifiInfo;
};

const setMetric = (profile, metric) => {
  clib(["connection", "modify", String(profile), "ipv4.route-metric", String(metric)])
}

const getMetric = async (profile) => {
  try {
    const data = await clib(["connection", "show", profile]);
  
    if (Array.isArray(data)) {
      const metric = data.find(item => item['ipv4.route-metric']); 

      if (metric) {
        return parseInt(metric['ipv4.route-metric'], 10);
      } else {
        throw new Error("Metric not found");
      }
    } else {
      throw new Error("Unexpected data format");
    }
  } catch (error) {
    throw new Error(`Error getting metric for ${profile}: ${error.message}`);
  }
};

const setAutoconnectStatus = async (profile, autoconnect) => {
  clib(["connection", "modify", String(profile), "connection.autoconnect", autoconnect])
}

const getAutoconnectStatus = async (profile) => {
  const data = await clib(["connection", "show", profile]);

  if (Array.isArray(data)) {
    const connection = data.find(item => item['connection.autoconnect']);
    return connection['connection.autoconnect'];
  } else {
    throw new Error("Unexpected data format");
  }
};

// exports
module.exports = {
  getIPv4,
  activityMonitor,
  // hostname
  getHostName,
  setHostName,
  // network
  enable,
  disable,
  getNetworkConnectivityState,
  // connection (profile)
  connectionUp,
  connectionDown,
  connectionDelete,
  getConnectionProfilesList,
  changeDnsConnection,
  addEthernetConnection,
  addGsmConnection,
  // device
  deviceStatus,
  deviceConnect,
  deviceDisconnect,
  getDeviceInfoIPDetail,
  getAllDeviceInfoIPDetailWithType,
  getAllDeviceInfoIPDetail,
  // wifi
  wifiEnable,
  wifiDisable,
  getWifiStatus,
  wifiHotspot,
  wifiCredentials,
  getWifiList,
  wifiConnect,
  setDhcpConnection,
  setStaticIpConnection,
  getDnsConnection,
  getIPv4ConfigMethod,
  getNetworkDeviceType,
  getWifiInfo,
  setMetric,
  getMetric,
  setAutoconnectStatus,
  getAutoconnectStatus
};


