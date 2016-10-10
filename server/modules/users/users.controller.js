var _ = require('lodash')
var auto = require('run-auto')
var crypto = require('crypto')
var passport = require('passport')
var mongoose = require('mongoose')
var User = mongoose.model('users')
var fs = require('fs')
var path = require('path')
var settings = require('../../../configs/settings.js').get()
var mail = require('../../mail.js')
var jwt = require('jsonwebtoken')

exports.getUsers = function (req, res, next) {
  User
    .find({})
    .select('-password')
    .exec(function (err, users) {
      if (err)next(err)
      res.send(users)
    })
}

exports.postAuthenticate = function (req, res, next) {
  var redirect = req.body.redirect || false
  req.assert('email', 'Email is not valid').isEmail()
  req.assert('password', 'Password cannot be blank').notEmpty()
  var errors = req.validationErrors()
  if (errors) {
    return res.status(401).send({
      success: false,
      authenticated: false,
      msg: errors[0].msg,
      redirect: '/signin'
    })
  } else {
    User.findOne({
      email: req.body.email
    }, function (err, user) {
      if (err) throw err
      if (!user) {
        res.send({
          success: false,
          authenticated: false,
          msg: 'Authentication failed. User not found.',
          redirect: '/signin'
        })
      } else {
        user.comparePassword(req.body.password, function (err, isMatch) {
          if (isMatch && !err) {
            req.logIn(user, function (err) {
              if (err) {
                return next(err)
              }
              delete user['password']
              var token = jwt.sign({
                _id: user._id
              }, settings.jwt.secret, settings.jwt.options) // good for two hours
              res.cookie('token', token)
              res.json({
                success: true,
                authenticated: true,
                user: {
                  profile: user.profile,
                  roles: user.roles,
                  gravatar: user.gravatar,
                  email: user.email,
                  _id: user._id
                },
                token: 'JWT ' + token,
                redirect: redirect
              })
            })
          } else {
            res.send({
              success: false,
              authenticated: false,
              msg: 'Authentication failed. Wrong password.',
              redirect: '/signin'
            })
          }
        })
      }
    })
  }
}

exports.getAuthenticate = function (req, res) {
  var redirect = req.body.redirect || false
  if (req.user) {
    var token = jwt.sign({
      _id: req.user._id
    }, settings.jwt.secret, settings.jwt.options)
    return res.status(200).send({
      user: {
        profile: req.user.profile,
        roles: req.user.roles,
        gravatar: req.user.gravatar,
        email: req.user.email,
        _id: req.user._id
      },
      token: token,
      success: true,
      authenticated: true,
      redirect: redirect
    })
  } else {
    res.status(200).send({
      user: {},
      success: false,
      authenticated: false,
      redirect: redirect
    })
  }
}

exports.postLogin = function (req, res, next) {
  req.assert('email', 'Email is not valid').isEmail()
  req.assert('password', 'Password cannot be blank').notEmpty()

  var errors = req.validationErrors()
  var redirect = req.body.redirect || false
  if (errors) {
    return res.status(400).send({
      success: false,
      authenticated: false,
      msg: errors[0].msg,
      redirect: '/signin'
    })
  }
  passport.authenticate('local', function (err, user, info) {
    if (err) {
      return next(err)
    }
    if (!user) {
      return res.status(400).send({
        success: false,
        authenticated: false,
        msg: info.message,
        redirect: false
      })
    }
    req.logIn(user, function (err) {
      if (err) {
        return next(err)
      }
      delete user['password']
      var token = jwt.sign({
        _id: user._id
      }, settings.jwt.secret, settings.jwt.options) // good for two hours
      res.cookie('token', token)
      res.json({
        success: true,
        authenticated: true,
        user: {
          profile: user.profile,
          roles: user.roles,
          gravatar: user.gravatar,
          email: user.email,
          _id: user._id
        },
        token: 'JWT ' + token,
        redirect: redirect
      })
    })
  })(req, res, next)
}

exports.logout = function (req, res) {
  req.logout()
  res.status(200).send('/')
}

exports.postSignup = function (req, res, next) {
  req.assert('profile', 'Name must not be empty').notEmpty()
  req.assert('email', 'Email is not valid').isEmail()
  req.assert('password', 'Password must be at least 6 characters long').len(6)
  req.assert('confirmPassword', 'Passwords do not match').equals(req.body.password)

  var errors = req.validationErrors()
  var redirect = req.body.redirect || false
  if (errors) {
    return res.status(400).send({
      success: false,
      authenticated: false,
      msg: errors[0].msg,
      redirect: '/signup'
    })
  }
  var user = new User({
    email: req.body.email,
    password: req.body.password,
    profile: {
      name: req.body.profile.name
    }
  })

  User.findOne({ email: req.body.email }, function (err, existingUser) {
    if (err) {
      return res.status(400).send(err)
    }
    if (existingUser) {
      return res.status(400).send({ msg: 'Account with that email address already exists.' })
    }
    user.save(function (err) {
      if (err && err.code === 11000) {
        return res.status(400).send({ msg: 'Account with that email address already exists.' })
      } else if (err && err.name === 'ValidationError') {
        var keys = _.keys(err.errors)
        return res.status(400).send({ msg: err.errors[keys[0]].message }) // err.message
      } else if (err) {
        next(err)
      } else {
        req.logIn(user, function (err) {
          if (err) {
            return next(err)
          } else {
            delete user['password']
            var token = jwt.sign({
              _id: user._id
            }, settings.jwt.secret, settings.jwt.options) // good for two hours
            res.cookie('token', token)
            res.json({
              success: true,
              authenticated: true,
              user: {
                profile: user.profile,
                roles: user.roles,
                gravatar: user.gravatar,
                email: user.email,
                _id: user._id
              },
              token: 'JWT ' + token,
              redirect: redirect
            })
          }
        })
      }
    })
  })
}

exports.putUpdateProfile = function (req, res, next) {
  var redirect = req.body.redirect || false
  User.findById(req.user.id, function (err, user) {
    if (err) {
      return next(err)
    }
    user = _.merge(user, req.body)
    // user.email = req.body.email || ''
    // user.profile.name = req.body.name || ''
    // user.profile.gender = req.body.gender || ''
    // user.profile.location = req.body.location || ''
    // user.profile.website = req.body.website || ''
    user.save(function (err) {
      if (err) {
        return next(err)
      }
      // req.flash('success', { msg: 'Profile information updated.' })
      res.status(200).send({
        user: user,
        redirect: redirect
      })
    })
  })
}

exports.putUpdatePassword = function (req, res, next) {
  req.assert('password', 'Password must be at least 4 characters long').len(4)
  req.assert('confirmPassword', 'Passwords do not match').equals(req.body.password)

  var errors = req.validationErrors()

  if (errors) {
    return res.status(200).send(errors)
  }

  User.findById(req.user.id, function (err, user) {
    if (err) {
      return next(err)
    }
    user.password = req.body.password
    user.save(function (err) {
      if (err) {
        return next(err)
      }
      req.flash('success', { msg: 'Password has been changed.' })
      res.status(200).send('/account')
    })
  })
}

exports.deleteDeleteAccount = function (req, res, next) {
  User.remove({ _id: req.user.id }, function (err) {
    if (err) {
      return next(err)
    }
    req.logout()
    res.status(200).send('/')
  })
}

exports.getReset = function (req, res) {
  if (req.isAuthenticated()) {
    return res.status(400).send({
      msg: 'Already authenticated',
      valid: false
    })
  } else {
    User
      .findOne({ resetPasswordToken: req.params.token })
      .where('resetPasswordExpires').gt(Date.now())
      .exec(function (err, user) {
        if (err) {
          return res.status(400).send(err)
        }
        if (!user) {
          // req.flash('errors', { msg: 'Password reset token is invalid or has expired.' })
          return res.status(400).send({
            msg: 'Password reset token is invalid or has expired.',
            valid: false
          })
        }
        res.status(200).send({
          msg: 'token is valid',
          valid: true
        })
      })
  }
}

exports.postReset = function (req, res, next) {
  req.assert('password', 'Password must be at least 4 characters long.').len(4)
  req.assert('confirmPassword', 'Passwords must match.').equals(req.body.password)
  var errors = req.validationErrors()

  if (errors) {
    // req.flash('errors', errors)
    return res.status(400).send({msg: errors})
  } else {
    auto({
      user: function (callback) {
        User
          .findOne({ resetPasswordToken: req.params.token })
          .where('resetPasswordExpires').gt(Date.now())
          .exec(function (err, user) {
            if (err) {
              return next(err)
            }
            if (!user) {
              return res.status(400).send({msg: 'no user found to reset password for. please hit reset password to get another token'})
            }
            user.password = req.body.password
            user.resetPasswordToken = undefined
            user.resetPasswordExpires = undefined
            user.save(function (err) {
              if (err) {
                return next(err)
              }
              req.logIn(user, function (err) {
                callback(err, user)
              })
            })
          })
      },
      sendEmail: ['user', function (results, callback) {
        mail.send({
          to: results.user.email,
          subject: settings.email.templates.reset.subject,
          text: settings.email.templates.reset.text(results.user.email)
        }, function (err) {
          callback(err, true)
        })
      }]
    }, function (err, user) {
      if (err) {
        return next(err)
      }
      delete user.password
      var redirect = req.body.redirect || '/'
      res.status(200).send({
        success: true,
        authenticated: true,
        user: user,
        redirect: redirect
      })
    })
  }
}

exports.postForgot = function (req, res, next) {
  req.assert('email', 'Please enter a valid email address.').isEmail()

  var errors = req.validationErrors()

  if (errors) {
    return res.status(400).send(errors)
  }

  auto({
    token: function (done) {
      crypto.randomBytes(16, function (err, buf) {
        var token = buf.toString('hex')
        done(err, token)
      })
    },
    user: ['token', function (results, callback) {
      User.findOne({ email: req.body.email.toLowerCase() }, function (err, user) {
        if (err) {
          return res.status(400).send(err)
        }
        if (!user) {
          return res.status(200).send('/forgot')
        }
        user.resetPasswordToken = results.token
        user.resetPasswordExpires = Date.now() + 3600000 // 1 hour
        user.save(function (err) {
          callback(err, user)
        })
      })
    }],
    sendEmail: ['user', function (results, callback) {
      mail.send({
        to: results.user.email,
        subject: settings.email.templates.forgot.subject,
        text: settings.email.templates.forgot.text(req.headers.host, results.token)
      }, function (err) {
        callback(err, true)
      })
    }]
  }, function (err) {
    if (err) {
      return next(err)
    }
    res.status(200).send({ msg: 'Email has been sent' })
  })
}

exports.postPhoto = function (req, res, next) {
  if (req.file) {
    var filePath = path.resolve(__dirname, '../../../client/uploads/')
    fs.readFile(req.file.path, function (err, data) {
      if (err) {
        return res.status(400).send(err)
      }
      var createDir = filePath + '/' + req.file.originalname
      fs.writeFile(createDir, data, function (err) {
        if (err) {
          return res.status(400).send(err)
        } else {
          return res.status(201).send()
        }
      })
    })
  } else {
    return res.status(400).send()
  }
}
