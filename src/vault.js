var Secret = function(name, secret, path) {
  var self = this;

  self.name = ko.observable(name);
  self.secret = ko.observable(secret);
  self.visible = ko.observable(false);

  self.id = ko.computed(function() {
    return path + '/' + self.name();
  });

  self.fieldType = ko.computed(function() {
    return self.visible() ? 'password' : 'text';
  });

  self.buttonText = ko.computed(function() {
    return self.visible() ? 'Show' : 'Hide';
  });

  self.toggleVisible = function() {
    self.visible(!self.visible());
  }
}

var SecretCollection = function(path, secrets) {
  var self = this;

  self.path = ko.observable(path);
  self.secrets = ko.observableArray();

  if (secrets) {
    Object.keys(secrets).forEach(function(key, index) {
      if (key !== 'lease_duration') {
        self.secrets.push(new Secret(key, secrets[key], path));
      }
    });
  }

  self.getSecretsAsObject = function() {
    var secrets = {};
    ko.utils.arrayForEach(self.secrets(), function(s) {
      secrets[s.name()] = s.secret();
    });
    return secrets;
  }

  self.edit = function() {
    var collection = new SecretCollection(path, self.getSecretsAsObject());
    page.secretForm().setupEdit(collection);
    page.secretForm().show();
  }

  self.save = function() {
    page.apiWrite(self.path(), self.getSecretsAsObject());
  }

  self.removeSecret = function(secret) {
    self.secrets.splice(self.secrets().indexOf(secret), 1);
  }

  self.deleteCollection = function() {
    page.apiDelete(self.path());
  }
}

var SecretForm = function() {
  var self = this;

  self.secretCollection = ko.observable();
  self.title = ko.observable();
  self.editMode = ko.observable();

  self.setupNew = function() {
    self.secretCollection(new SecretCollection('secret/'));
    self.addEmptySecret();
    self.title('Add New Secret');
    self.editMode(false);
  }

  self.setupEdit = function(collection) {
    self.secretCollection(collection);
    self.title('Edit Secret');
    self.editMode(true);
  }

  self.show = function() {
    $('#vaultAddModal').modal('show');
  }

  self.hide = function() {
    $('#vaultAddModal').modal('hide');
  }

  self.submit = function() {
    self.hide();
    self.secretCollection().save();
    self.setupNew();
  }

  self.deleteSecret = function() {
    if (confirm('Really delete ' + self.secretCollection().path() + ' ?')) {
      self.hide();
      self.secretCollection().deleteCollection();
      self.setupNew();
    }
  }

  self.addEmptySecret = function(collection) {
    self.secretCollection().secrets.push(new Secret('', ''));
  }

  self.setupNew();
}

var authMethodConfig = {
  'github-default': {
    'type': 'github',
    'mount': 'github/'
  },
  'userpass-default': {
    'type': 'userpass',
    'mount': 'userpass/'
  },

}

var supportedAuthMethods = {
    'token': { 'desc': "Token authentication", 'data': { 'token': "" } },
    'github': { 'desc': "GitHub authentication", 'data': { 'token': "" } },
    'app-id': { 'desc': "App ID authentication", 'data': { 'app_id': "", 'user_id': "" } },
    'ldap': { 'desc': "LDAP authentication", 'data': { 'username': "", 'password': "", 'passcode': "" } },
    'userpass': { 'desc': "Username/password authentication", 'data': { 'username': "", 'password': "", 'passcode': "" } }
}

var authMethod = function(name, type, path, desc, data) {
  var self = this;

  self.name = name;
  self.type = type;
  self.path = path;
  self.desc = desc;
  self.data = data;
}

var availableAuthMethods = function(){
    var authArray = [];
    var authToken = supportedAuthMethods['token'];
    authArray.push(new authMethod('token', 'token', '', authToken.desc, authToken.data));
    for (name in authMethodConfig) {
      var auth = authMethodConfig[name];
      var type = auth.type;
      var data = supportedAuthMethods[type].data;
      var path = auth.mount;
      var desc = supportedAuthMethods[type].desc;
      authArray.push(new authMethod(name, type, path, desc, data))
    }
    return authArray;
}

var Page = function() {
  var self = this;
  var authMethods = new availableAuthMethods();

  self.endpoint = ko.observable(localStorage.vaultEndpoint);
  self.client_token = ko.observable();
  self.client_id = ko.observable();
  self.client_otp = ko.observable();
  self.token = ko.observable(localStorage.vaultToken);
  self.authMethods = ko.observableArray(authMethods);
  self.selectedAuthType = ko.observable(authMethods[0]);
  self.secrets = ko.observableArray();
  self.secretForm = ko.observable(new SecretForm());
  self.vaultHealthResponse = ko.observable();
  self.vaultTokenResponse = ko.observable();

  self.endpoint.subscribe(function (text) {
    localStorage.vaultEndpoint = text;
  });

  self.token.subscribe(function (text) {
    localStorage.vaultToken = text;
  });

  self.sortByPath = function(left, right) {
    return left.path() > right.path() ? 1 : -1;
  }

  self.reloadAll = function() {
    self.secrets([]);
    console.log(self.client_token());
    if (self.selectedAuthType().type != 'token') {
      self.getClientToken(self.selectedAuthType(), self.client_token());
    } else {
      self.token(self.client_token());
    }
    self.apiList('secret/');
  }

  self.logout = function() {
    self.secrets([]);
  }

  self.getHeaders = function() {
    return {'X-Vault-Token': self.token()};
  }

  self.getJsonHeaders = function() {
    var headers = self.getHeaders();
    headers['Content-Type'] = 'application/json';
    return headers;
  }

  self.getUrl = function(path) {
    return self.endpoint() + '/v1/' + path
  }

  self.apiHealth = function() {
    $.ajax({
      url: self.getUrl('sys/health'),
      success: self.apiHealthSuccess,
      error: onError
    });
  }

  self.getClientToken = function(auth, token) {
    var path = "auth/" + auth.path + 'login';
    console.log(auth);
    console.log(auth.data);
    if (auth.data.username) {
      path += '/' + auth.data.username;
    } 
    if (auth.data.app_id) {
      path += '/' + auth.data.app_id;
    }
    console.log(path);
    $.ajax({
      url: self.getUrl(path),
      method: 'POST',
      data: toJson({ "token": token }),
      success: self.apiClientTokenSuccess,
      error: onError
    });
  }


  self.apiToken = function() {
    $.ajax({
      url: self.getUrl('auth/token/lookup-self'),
      headers: self.getHeaders(),
      success: self.apiTokenSuccess,
      error: onError
    });
  }

  self.apiList = function(path) {
    $.ajax({
      url: self.getUrl(path),
      data: {'list': 'true'},
      headers: self.getHeaders(),
      success: self.apiListSuccess(path),
      error: onError
    });
  }

  self.apiRead = function(path) {
    $.ajax({
      url: self.getUrl(path),
      headers: self.getHeaders(),
      success: self.apiReadSuccess(path),
      error: onError
    });
  }

  self.apiWrite = function(path, data) {
    $.ajax({
      url: self.getUrl(path),
      data: toJson(data),
      method: 'POST',
      headers: self.getJsonHeaders(),
      success: self.reloadAll,
      error: onError
    });
  }

  self.apiDelete = function(path) {
    $.ajax({
      url: self.getUrl(path),
      method: 'DELETE',
      headers: self.getHeaders(),
      success: self.reloadAll,
      error: onError
    });
  }

  self.apiHealthSuccess = function(data) {
    self.vaultHealthResponse(toJson(data));
  }

  self.apiTokenSuccess = function(data) {
    console.log(data);
    self.vaultTokenResponse(toJson(data.data));
  }

  self.apiClientTokenSuccess = function(data) {
    self.token(data.auth.client_token);
  }

  self.apiListSuccess = function(path) {
    return function(data) {
      var keys = data.data.keys;
      for (var key in keys) {
        var name = keys[key];
        if (name.endsWith('/')) {
          self.apiList(path + name);
        } else {
          self.apiRead(path + name);
        }
      }
    }
  }

  self.apiReadSuccess = function(path) {
    return function(data) {
      self.secrets.push(new SecretCollection(path, data.data));
    }
  }
}

var onError = function(response) {
  $('#errorModalBody').text(toJson(response));
  $('#errorModal').modal('show');
}

var toJson = function(object) {
  return JSON.stringify(object, null, 2)
}

var page = new Page();
ko.applyBindings(page);


if (page.endpoint() && page.token()) {
  page.reloadAll();
}
