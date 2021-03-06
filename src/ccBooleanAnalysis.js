//    ccBooleanAnalysis 0.1.0
//    ccBooleanAnalysis may be distributed ____
//    http://future.com

/*global module: true, exports: true, console: true */
// (function (root) {
//   'use strict';
  /* External Modules */
  var jsep = require('jsep');
  var Queue = require('./queue.js').Queue;
  var Logic = require('logic-solver');

  /* Module setup */
  var ccBooleanAnalysis = function () {};

  ////////////////////////////////////////
  ////////////////////////////////////////
  ////            Constants
  ////
  ////////////////////////////////////////
  ////////////////////////////////////////

  ccBooleanAnalysis._constants = {
    kNOT: '~',
    kAND: '*',
    kOR: '+',
    kBinaryExpression: "BinaryExpression",
    kUnaryExpression: "UnaryExpression",
    kIdentifier: "Identifier"
  };

  ////////////////////////////////////////
  ////////////////////////////////////////
  ////      Parse Boolean Tree
  ////
  ////////////////////////////////////////
  ////////////////////////////////////////

  ccBooleanAnalysis.getParseTree = function(s) {
    // unaryOps are broken in Jsep.
    // Instead, we conver to the single unaryOp
    // that currently works.
    // https://github.com/soney/jsep/issues/43
    var find = 'NOT';
    var re = new RegExp(find, 'g');
    s = s.replace(re, '~');

    var find = 'AND';
    var re = new RegExp(find, 'g');
    s = s.replace(re, '*');

    var find = 'OR';
    var re = new RegExp(find, 'g');
    s = s.replace(re, '+');

    return jsep(s);
  }

  ////////////////////////////////////////
  ////////////////////////////////////////
  ////        Boolean Equivalence
  ////
  ////////////////////////////////////////
  ////////////////////////////////////////

  /**
   * @method ccBooleanAnalysis.getDNFObjectEncoding
   * @param {string} s A string representing the boolean expression that should be transformed.
   * @return {object} A hashtable representing the expression in DNF form. Useful for various functions in our library.
   */
  ccBooleanAnalysis.getDNFObjectEncoding = function(s) {
    var iterateAndTree = function(positive_holder, negative_holder, parse_tree) {
      if (parse_tree.type == ccBooleanAnalysis._constants.kIdentifier) {
        positive_holder.data.push(parse_tree.name);
      } else if (parse_tree.type == ccBooleanAnalysis._constants.kUnaryExpression) {
        negative_holder.data.push(parse_tree.argument.name);
      } else {
       iterateAndTree(positive_holder, negative_holder, parse_tree.left);
       iterateAndTree(positive_holder, negative_holder, parse_tree.right);
      }
    }

    var iterateOrTree = function(conjuctions, parse_tree) {
      if (parse_tree.type == ccBooleanAnalysis._constants.kIdentifier) {
        conjuctions.data.push([[parse_tree.name], []]);
      } else if (parse_tree.operator == ccBooleanAnalysis._constants.kAND) {
        var and_positive_holder = {data: []};
        var and_negative_holder = {data: []};
        iterateAndTree(and_positive_holder, and_negative_holder, parse_tree);

        and_positive_holder.data = and_positive_holder.data.filter(ccBooleanAnalysis._uniqueFilter).sort();
        and_negative_holder.data = and_negative_holder.data.filter(ccBooleanAnalysis._uniqueFilter).sort();

        // if you have a term in both pos and neg,
        // then the expresion evaluates to "false."
        // Since (false OR X) == X,
        // we don't have to add "false" to the set of conjuctions..
        if (!(ccBooleanAnalysis._shares_term(and_positive_holder.data, and_negative_holder.data))) {
          conjuctions.data.push([and_positive_holder.data, and_negative_holder.data]);
        }
      } else if (parse_tree.type == ccBooleanAnalysis._constants.kUnaryExpression) {
        conjuctions.data.push([[], [parse_tree.argument.name]]);
      } else { // kOR
        iterateOrTree(conjuctions, parse_tree.left);
        iterateOrTree(conjuctions, parse_tree.right);
      }
    }

    // Convert parse tree format to DNF
    var parse_tree = this.getParseTree(s);
    this._convertToNegationForm(parse_tree);
    this._pushDownAnds(parse_tree);

    // Main Logic
    conjuctions = {data: []};
    iterateOrTree(conjuctions, parse_tree);

    for (var i = 0; i < conjuctions.data.length; i++) {
      var conjuction_a = conjuctions.data[i];

      // If a conjuction is a subpart of another one (considering negations),
      // then discard the larger one.
      for (var j = i + 1; j < conjuctions.data.length; j++) {
        var conjuction_b = conjuctions.data[j];
        var subset = [ccBooleanAnalysis._is_subset(conjuction_a[0], conjuction_b[0]), ccBooleanAnalysis._is_subset(conjuction_a[1], conjuction_b[1])];
        if (subset[0] == 2 && subset[1] == 2) {
          // throw away conjuction_a
          conjuctions.data.splice(i, 1);
          i--; j--;
          break; // start over the j's on the next i.
        } else if (subset[0] == 1 && subset[1] == 1) {
          // throw away conjuction_b
          conjuctions.data.splice(j, 1);
          j--;
        }
      }
    }

    var conjuctions_hashtable = {};
    for (var i = 0; i < conjuctions.data.length; i++) {
      var conjuction = conjuctions.data[i];
      var key = this._get_union(conjuction[0], conjuction[1]).join('');

      var no_collision = true;
      if (key in conjuctions_hashtable) {
        var collisions = conjuctions_hashtable[key];
        for (var j = 0; j < collisions.length; j++) {
          var collision = collisions[j];

          // heuristic to avoid taking intersection in every case
          var collision_has_neg = ((collision[0].length == conjuction[0].length - 1) && (collision[1].length == conjuction[1].length + 1));
          var conjuction_has_neg = ((collision[0].length == conjuction[0].length + 1) && (collision[1].length == conjuction[1].length - 1));

          if (collision_has_neg || conjuction_has_neg) {
            if (collision_has_neg) {
              var conjuction_a = conjuction.slice();
              var conjuction_b = collision.slice();
            } else {
              var conjuction_a = collision.slice();
              var conjuction_b = conjuction.slice();
            }

            // get and remove this intersection
            var intersection = [this._remove_intersection(conjuction_a[0], conjuction_b[0]), this._remove_intersection(conjuction_a[1],   conjuction_b[1])];

            // confirm that the only difference is a term switched from pos to neg
            if (conjuction_a[0].length == 1 && conjuction_a[1].length == 0 && conjuction_b[1].length == 1 && conjuction_b[0].length == 0 &&   conjuction_a[0][0] ==  conjuction_b[1][0]) {
              no_collision = false; // mark that we've had a collision

              // remove the collision
              conjuctions_hashtable[key].splice(j, 1);
              j--;

              var new_key = this._get_union(intersection[0], intersection[1]).join('');
              if (new_key in conjuctions_hashtable) {
                conjuctions_hashtable[new_key].push(intersection);
              } else {
                conjuctions_hashtable[new_key] = [intersection];
              }
            }
          }
        }
      }
      if (no_collision) {
        if (!(key in conjuctions_hashtable)) {
          conjuctions_hashtable[key] = [conjuction];
        } else {
          conjuctions_hashtable[key].push(conjuction);
        }

      }
    }

    return conjuctions_hashtable;
  }

  /**
   * @method ccBooleanAnalysis.getDNFStringEncoding
   * @param {string} s A string representing the boolean expression that should be transformed.
   * @return {string} A string encoding of the boolean expression in DNF.
   */
  ccBooleanAnalysis.getDNFStringEncoding = function(s) {
    var conjuctions_hashtable = this.getDNFObjectEncoding(s);

    var final_conjuctions = [];
    for (var key in conjuctions_hashtable) {
      var conjuctions = conjuctions_hashtable[key];
      for (var i = 0; i < conjuctions.length; i++) {
        var conjuction = conjuctions[i];
        final_conjuctions.push((conjuction[0].join('%')) + '~' + (conjuction[1].join('%')));
      }
    }

    return final_conjuctions.sort().join('|');
  }

  /**
   * @method ccBooleanAnalysis.compareBooleans
   * @param {string} s1 The first boolean expression to be compared.
   * @param {string} s2 The second boolean expression to be compared.
   * @return {string} A string encoding of the boolean expression in DNF.
   */
  ccBooleanAnalysis.compareBooleans = function(s1, s2) {
    var encoding1 = this.getDNFStringEncoding(s1);
    var encoding2 = this.getDNFStringEncoding(s2);

    return encoding1 == encoding2;
  }

  ////////////////////////////////////////
  ////////////////////////////////////////
  ////        Graph Manipulation
  ////
  ////////////////////////////////////////
  ////////////////////////////////////////

  /**
   * @method ccBooleanAnalysis._getGraph
   * @param {array[string]} equations Array of strings with boolean equations.
   * @param {boolean} label_pos_neg True if graph terms contain pos/neg indicators. False otherwise.
   * @return {obj} Javascript object representing the graph.
   */
  ccBooleanAnalysis._getGraph = function(equations, label_pos_neg) {
    var graph = {
      data: {}
    };

    // Generate parse trees for each expression
    for (var i = 0; i < equations.length; i++) {
      // Seperate each side of the equation
      var equation = equations[i];
      var sides = equation.split('=');

      // remove white space
      var lhs = sides[0].split(' ').join('');
      var expression = sides[1];
      var parse_tree = this.getParseTree(expression);

      // Sort the terms
      var terms = {
        data: []
      };

      this._convertToNegationForm(parse_tree);
      this._sortTerms(parse_tree, terms, label_pos_neg);

      // Here, we disregard whether a term is positive or negative
      // Annotate all terms on the graph
      for (var j = 0; j < terms.data.length; j++) {
        var term = terms.data[j];
        if (label_pos_neg) {
          var term_comps = term.split('___');
          var term_name = term_comps[0];
          var term_type = term_comps[1]; // pos or neg

          if (!(graph.data[term_name])) {
            graph.data[term_name] = [];
          }
          var resulting_term = lhs + '___' + term_type;
          graph.data[term_name].push(resulting_term);
        } else {
          if (!(graph.data[term])) {
            graph.data[term] = [];
          }
          graph.data[term].push(lhs);
        }
      }
    }
    return graph;
  }


  ////////////////////////////////////////
  ////////////////////////////////////////
  ////        Feedback Loops
  ////
  ////////////////////////////////////////
  ////////////////////////////////////////

  // Common method to find cycles.
  // Used for feedback loops and functional circuits.
  // Example of two embedded loops:
  // feedbackLoops(['A=D', 'B=A AND E', 'C=B', 'D=C','E=A'])
  // Returns:
  // [["A", "B", "C", "D", "A"], ["A", "E", "B", "C", "D", "A"]]
  var _findCycles = function(graph, cycles, cur_node, stack, in_progress, visited, global_visited, find_parities) {
    in_progress[cur_node] = true;
    stack.push(cur_node);

    var cur_node_comps = cur_node.split('___');
    var cur_node_name = cur_node_comps[0];
    var cur_node_type = cur_node_comps[1]; // pos or neg

    var neighbors = graph.data[cur_node_name];

    for (var i = 0; i < neighbors.length; i++) {
      var neighbor = neighbors[i];
      var neighbor_comps = neighbor.split('___');
      var neighbor_name = neighbor_comps[0];
      var neighbor_type = neighbor_comps[1]; // pos or neg

      // If there are no incoming nodes to this neighbor, we ignore it.
      if (!(neighbor_name in graph.data)) {
        continue;
      } else if (in_progress[neighbor]) {
        cycle = [neighbor_name];
        var parity = 0;
        for (var j = stack.length - 1; j >= 0; j--) {
          var stack_item_comps = stack[j].split('___');
          var stack_item_name = stack_item_comps[0];
          var stack_item_type = stack_item_comps[1]; // pos or neg

          if (stack_item_type == 'neg') {
            parity += 1;
          }
          cycle.push(stack_item_name);
          if (stack[j] == neighbor) {
            break;
          }
        }
        parity = parity % 2;

        // determine parity
        if (find_parities) {
          cycles.data.push({
            cycle: cycle.reverse(),
            type: parity
          });
        } else {
          cycles.data.push(cycle.reverse());
        }
      } else if (!(visited[neighbor])) {
        var visited_clone = ccBooleanAnalysis._clone(visited);
        var in_progress_clone = ccBooleanAnalysis._clone(in_progress);
        var stack_clone = stack.slice(0);
        _findCycles(graph, cycles, neighbor, stack_clone, in_progress_clone, visited_clone, global_visited, find_parities);
      }
    }
    in_progress[cur_node] = false;
    global_visited.data[cur_node_name] = true;
    visited[cur_node] = true;
  }

  // Essentially a wrapper for _findCycles.
  // Creates graph from equations and prepares data structures.
  var _feedbackLoopsCommon = function(equations, find_parities) {
    var graph = ccBooleanAnalysis._getGraph(equations, find_parities);

    // Find all cycles in the graph
    var cycles = {
      data: []
    };

    var global_visited = {
      data: {}
    };

    var has_incoming = Object.keys(graph.data);
    for (var i = 0; i < has_incoming.length; i++) {
      var node = has_incoming[i];
      if (!(global_visited.data[node])) {
        _findCycles(graph, cycles, node, [], {}, {}, global_visited, find_parities);
      }
    }
    return cycles.data;
  }

  /**
   * @method ccBooleanAnalysis.feedbackLoops
   * @param {array[string]} equations Array of strings with boolean equations.
   * @return {array[string]} Array containing the feedback loops.
   */
  ccBooleanAnalysis.feedbackLoops = function(equations) {
    return _feedbackLoopsCommon(equations, false);
  }

  /**
   * @method ccBooleanAnalysis.functionalCircuits
   * @param {array[string]} equations Array of strings with boolean equations.
   * @return {array[string]} Array containing the functional circuits.
   */
  ccBooleanAnalysis.functionalCircuits = function(equations) {
    return _feedbackLoopsCommon(equations, true);
  }

  ////////////////////////////////////////
  ////////////////////////////////////////
  ////        Distances
  ////
  ////////////////////////////////////////
  ////////////////////////////////////////

  /**
   * @method ccBooleanAnalysis.distances
   * @param {array[string]} equations Array of strings with boolean equations.
   * @return {obj} Javascript object where obj[a][b] represents dist(a,b).
   */
  ccBooleanAnalysis.distances = function(equations) {
    // Perform a breadth-first search beginning from each node.
    var distances = {}; // dictionary of dictionaries
    var graph = this._getGraph(equations);

    var has_outgoing = Object.keys(graph.data);
    for (var i = 0; i < has_outgoing.length; i++) {
      var root_node = has_outgoing[i];
      var visited = [];
      var dist = 0;
      var queue = new Queue();

      distances[root_node] = {};
      var neighbors = graph.data[root_node];
      for (var j = 0; j < neighbors.length; j++) {
        var neighbor = neighbors[j];
        distances[root_node][neighbor] = 1;
        queue.enqueue(neighbor);
      }

      while(!(queue.isEmpty())) {
        current = queue.dequeue();
        if (!(distances[current])) {
          distances[current] = {};
        }

        if (current in graph.data) {
          var neighbors = graph.data[current];
          for (var j = 0; j < neighbors.length; j++) {
            var neighbor = neighbors[j];
            if (!(neighbor in distances[root_node]) || (distances[root_node][neighbor] > distances[root_node][current] + 1)) {
              distances[root_node][neighbor] = distances[root_node][current] + 1;
              queue.enqueue(neighbor);
            }
            distances[current][neighbor] = 1;
          }
        }
      }
    }
    return distances;
  }

  /**
   * @method ccBooleanAnalysis.averageDistance
   * @param {array[string]} equations Array of strings with boolean equations.
   * @return {float} The average distance between nodes.
   */
  ccBooleanAnalysis.averageDistance = function(equations) {
    var distances = this.distances(equations);
    var nodes = Object.keys(distances);

    var total_distance = 0;
    var node_count = 0;
    for (var i = 0; i < nodes.length; i++) {
      var node1 = nodes[i];
      for (var j = i + 1; j < nodes.length; j++) {
        var node2 = nodes[j];
        total_distance += distances[node1][node2];
        node_count += 1;
      }
    }
    return total_distance / node_count;
  }

  /**
   * @method ccBooleanAnalysis.connectivity
   * @param {array[string]} equations Array of strings with boolean equations.
   * @return {obj} Javascript object where obj[a][b] is true if a and b are connected. False otherwise.
   */
  ccBooleanAnalysis.connectivity = function(equations) {
    var distances = this.distances(equations);
    var nodes = Object.keys(distances);

    var connectivity = {};

    for (var i = 0; i < nodes.length; i++) {
      var node1 = nodes[i];
      connectivity[node1] = {};
      for (var j = 0; j < nodes.length; j++) {
        var node2 = nodes[j];

        // is node1 connected to node2? (1 -> 2)
        var connected = (node2 in distances[node1]);
        connectivity[node1][node2] = connected;
      }
    }
    return connectivity;
  }

  /**
   * @method ccBooleanAnalysis.connectivityInDegree
   * @param {array[string]} equations Array of strings with boolean equations.
   * @return {obj} Javascript object where obj[a] is the in-degree of node a.
   */
  ccBooleanAnalysis.connectivityInDegree = function(equations) {
    var distances = this.distances(equations);
    var nodes = Object.keys(distances);

    var connectivity = {};

    for (var i = 0; i < nodes.length; i++) {
      var node1 = nodes[i];
      connectivity[node1] = 0;
      for (var j = 0; j < nodes.length; j++) {
        var node2 = nodes[j];

        // is node1 connected to node2? (1 -> 2)
        var connected = (node2 in distances[node1]);
        if (connected) {
          connectivity[node1] += 1;
        }
      }
    }
    return connectivity;
  }

  /**
   * @method ccBooleanAnalysis.connectivityOutDegree
   * @param {array[string]} equations Array of strings with boolean equations.
   * @return {obj} Javascript object where obj[a] is the out-degree of node a.
   */
  ccBooleanAnalysis.connectivityOutDegree = function(equations) {
    var distances = this.distances(equations);
    var nodes = Object.keys(distances);

    var connectivity = {};

    // initialize connectivity matrix
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      connectivity[node] = 0;
    }

    // compute degrees
    for (var i = 0; i < nodes.length; i++) {
      var node1 = nodes[i];
      for (var j = 0; j < nodes.length; j++) {
        var node2 = nodes[j];

        // is node1 connected to node2? (1 -> 2)
        var connected = (node2 in distances[node1]);
        if (connected) {
          connectivity[node2] += 1;
        }
      }
    }
    return connectivity;
  }

  /**
   * @method ccBooleanAnalysis.connectivityDegree
   * @param {array[string]} equations Array of strings with boolean equations.
   * @return {obj} Javascript object where obj[a] is the degree (in-degree + out-degree) of node a.
   */
  ccBooleanAnalysis.connectivityDegree = function(equations) {
    var distances = this.distances(equations);
    var nodes = Object.keys(distances);

    var connectivity = {};

    // initialize connectivity matrix
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      connectivity[node] = 0;
    }

    for (var i = 0; i < nodes.length; i++) {
      var node1 = nodes[i];
      for (var j = 0; j < nodes.length; j++) {
        var node2 = nodes[j];

        // is node1 connected to node2? (1 -> 2)
        var connected = (node2 in distances[node1]);
        if (connected) {
          connectivity[node1] += 1;
          connectivity[node2] += 1;
        }
      }
    }
    return connectivity;
  }

  /**
   * @method ccBooleanAnalysis.connectivityDistributionGraph
   * @param {array[string]} equations Array of strings with boolean equations.
   * @return {obj} Javascript object with keys inDegree, outDegree, and degree, following same format
   * as those respective functions in ccBooleanAnalysis library.
   */
  ccBooleanAnalysis.connectivityDistributionGraph = function(equations) {
    return {
      'inDegree': ccBooleanAnalysis.connectivityInDegree(equations),
      'outDegree': ccBooleanAnalysis.connectivityOutDegree(equations),
      'degree': ccBooleanAnalysis.connectivityDegree(equations)
    }
  }

  /**
   * @method ccBooleanAnalysis.averageDistance
   * @param {array[string]} equations Array of strings with boolean equations.
   * @return {obj} Javascript object where obj[node] = average connectivity of the node.
   */
  ccBooleanAnalysis.averageConnectivity = function(equations) {
    var connectivity = this.connectivity(equations);

    var averageConnectivity = {};
    for (var source in connectivity) {
      var connected_targets = 0;
      var total_targets = 0;
      for (var target in connectivity[source]) {
        total_targets += 1;
        if (connectivity[source][target]) {
          connected_targets += 1;
        }
      }
      averageConnectivity[source] = connected_targets / total_targets;
    }
    return averageConnectivity;
  }

  /**
   * @method ccBooleanAnalysis.diameter
   * @param {array[string]} equations Array of strings with boolean equations.
   * @return {obj} Javascript object where obj[a][b] is True if a and b are connected. False otherwise.
   */
  ccBooleanAnalysis.diameter = function(equations) {
    var distances = this.distances(equations);
    var diameter = 0;
    for (source in distances) {
      for (target in distances[source]) {
        var distance = distances[source][target];
        if (distance > diameter) {
          diameter = distance;
        }
      }
    }
    return diameter;
  }

  ////////////////////////////////////////
  ////////////////////////////////////////
  ////     Biological Regulators
  ////
  ////////////////////////////////////////
  ////////////////////////////////////////

  /*
   * Accepts a parse_tree created using jsep library.
   * http://jsep.from.so/
   *
   * Vanilla conversion algorithm:
   * 1) Convert to negation normal form
   *    a) ~(A or B) --> ~A and ~B
   *    b) ~(A and B) --> ~A or ~B
   *    c) ~(~A) --> A
   *
   * 2) Distribute AND over ORs.
   *    - A and (B or C) --> (A and B) or (A and C)
   *
   * Recursively apply these techniques to reach DNF.
   */
   getRegulators = function(parse_tree) {
    // Tree traversal methods
    var iterateAndTree = function(positive_holder, negative_holder, parse_tree) {
      if (parse_tree.type == ccBooleanAnalysis._constants.kIdentifier) {
        positive_holder.data.push(parse_tree.name);
      } else if (parse_tree.type == ccBooleanAnalysis._constants.kUnaryExpression) {
        negative_holder.data.push(parse_tree.argument.name);
      } else {
       iterateAndTree(positive_holder, negative_holder, parse_tree.left);
       iterateAndTree(positive_holder, negative_holder, parse_tree.right);
      }
    }

    var iterateOrTree = function(positive_holder, negative_holder, parse_tree) {
      if (parse_tree.operator == ccBooleanAnalysis._constants.kAND) {
        var and_positive_holder = {data: []};
        var and_negative_holder = {data: []};
        iterateAndTree(and_positive_holder, and_negative_holder, parse_tree);

        // Setup positive regulators
        if (and_positive_holder.data.length > 0) {
          var first_positive_name = and_positive_holder.data[0];
          if (!(first_positive_name in positive_holder.data)) {
            positive_holder.data[first_positive_name] = {
              component: first_positive_name,
              type: true,
              conditionRelation: true,
              conditions: [],
            };
          }
          var condition_components = [];
          for (var i = 1; i < and_positive_holder.data.length; i++) {
            condition_components.push(and_positive_holder.data[i]);
          }
          positive_holder.data[first_positive_name].conditions.push({
            state: true, // active
            type: true, // if/when
            components: condition_components
          });
        }

        // Setup negative regulators
        for (var i = 0; i < and_negative_holder.data.length; i++) {
          if (!(and_negative_holder.data[i] in negative_holder)) {
            negative_holder.data[and_negative_holder.data[i]] = {
              component: and_negative_holder.data[i],
              type: false,
              dominants: []
            };
          }
          if (and_positive_holder.length > 0) {
            negative_holder.data[and_negative_holder.data[i]].dominants.push(positive_holder.data[first_positive_name]);
          }
        }
      } else if (parse_tree.type == ccBooleanAnalysis._constants.kIdentifier) {
        // Add a positive regulator with no conditions
        var positive_regulator_name = parse_tree.name;
        if (!(positive_regulator_name in positive_holder.data)) {
          positive_holder.data[positive_regulator_name] = {
            component: positive_regulator_name,
            type: true
          };
        }
      } else if (parse_tree.type == ccBooleanAnalysis._constants.kUnaryExpression) {
        // Add a negative regulator with no conditions
        var negative_regulator_name = parse_tree.argument.name;
        if (!(negative_regulator_name in negative_holder.data)) {
          negative_holder.data[negative_regulator_name] = {
            component: negative_regulator_name,
            type: true
          };
        }
      } else { // kOR
        iterateOrTree(positive_holder, negative_holder, parse_tree.left);
        iterateOrTree(positive_holder, negative_holder, parse_tree.right);
      }
    }

    // Main Logic
    positive_holder = {data: {}};
    negative_holder = {data: {}};

    iterateOrTree(positive_holder, negative_holder, parse_tree);

    var regulators = [];
    for (var key in positive_holder.data) {
      regulators.push(positive_holder.data[key]);
    }
    for (var key in negative_holder.data) {
      regulators.push(negative_holder.data[key]);
    }

    return regulators;
  }

  // Recursively finds all terms in a parse_tree
  // and store them in a terms data structure,
  // which should be structured as
  // {'data': []}.
  var _getTerms = function(parse_tree, terms) {
    if (parse_tree.operator == ccBooleanAnalysis._constants.kAND || parse_tree.operator == ccBooleanAnalysis._constants.kOR) {
      _getTerms(parse_tree.left, terms);
      _getTerms(parse_tree.right, terms);
    } else if (parse_tree.type == ccBooleanAnalysis._constants.kUnaryExpression) {
      _getTerms(parse_tree.argument, terms);
    } else if (parse_tree.type == ccBooleanAnalysis._constants.kIdentifier) {
      terms.data.push(parse_tree.name);
    }
  }

  /**
   * @method ccBooleanAnalysis.getBiologicalConstructs
   * @param {jsep} s A string (from a human) of the boolean expression.
   * @return {obj} Javascript object representing the regulators. They are formatted as such:
   *  {
   *     regulators: [...],
   *     absentState: true
   *  }
   *
   * Each regulator is structured as follows:
   *     "component" - name of the given component (name of the variable in parsed expression)
   *     "type" - false (negative regulator), true (positive regulator) (not mandatory - false is default)
   *     "conditionRelation" - false (or = independent), true (and = cooperative) (not mandatory - false is default)
   *     "conditions" - array of condition objects (described bellow) is not mandatory if given regulator does not have any conditions
   *     "dominants" - array of regulators that are dominant over this regulator, not mandatory
   *     "recessives" - array of regulators that this regulator is dominant over, not mandatory
   *
   *     condition object contains following properties:
   *     "componentRelation" - false (or = independent), true (and = cooperative), not mandatory - false is default
   *     "subConditionRelation" - false (or = independent), true (and = cooperative), not mandatory - false is default
   *     "state" - false (inactive), true (active), not mandatory - false is default
   *     "type" - false (unless), true (if when), not mandatory - false is default
   *     "components" - array of component names (variables in parsed expression), this should contain at least one component
   *     "conditions" - array of subcondition objects (described bellow), not mandatory
   *
   *     subcondition object contains following properties:
   *     "componentRelation" - false (or = independent), true (and = cooperative), not mandatory - false is default
   *     "state" - false (inactive), true (active), not mandatory - false is default
   *     "type" - false (unless), true (if when), not mandatory - false is default
   *     "components" - array of component names (variables in parsed expression), this should contain at least one component
   */
  ccBooleanAnalysis.getBiologicalConstructs = function(s) {
    // First, check for absent state
    // If structure is A OR ~B:
    //    get all terms in A
    //    get all terms in B
    // If the two arrays are the same:
    //    then set parse tree = A and absentState = false
    // Else:
    //    then set parse tree = original parse tree, absentState = true

    var pt = this.getParseTree(s);
    var absentState = false;
    if (pt.operator == ccBooleanAnalysis._constants.kOR && pt.right.type == ccBooleanAnalysis._constants.kUnaryExpression) {
      data_left = {'data': []};
      data_right = {'data': []};

      this._getTerms(pt.left, data_left);
      this._getTerms(pt.right.argument, data_right);

      var isSuperset = data_left.data.every(function(val) { return data_right.data.indexOf(val) >= 0; });

      if (isSuperset) {
        pt = pt.left;
        absentState = true;
      }
    }

    // Continue with whatever parse_tree and absentState we have
    this._convertToNegationForm(pt);
    this._pushDownAnds(pt);
    var regulators = getRegulators(pt);
    return {
      regulators: regulators,
      absentState: absentState
    };
  }

  ////////////////////////////////////////
  ////////////////////////////////////////
  ////     Misc Helpers
  ////
  ////////////////////////////////////////
  ////////////////////////////////////////

  // Clone a javascript object / dictionary
  ccBooleanAnalysis._clone = function(item) {
      if (!item) { return item; } // null, undefined values check

      var types = [ Number, String, Boolean ],
          result;

      // normalizing primitives if someone did new String('aaa'), or new Number('444');
      types.forEach(function(type) {
          if (item instanceof type) {
              result = type( item );
          }
      });

      if (typeof result == "undefined") {
          if (Object.prototype.toString.call( item ) === "[object Array]") {
              result = [];
              item.forEach(function(child, index, array) {
                  result[index] = ccBooleanAnalysis._clone( child );
              });
          } else if (typeof item == "object") {
              // testing that this is DOM
              if (item.nodeType && typeof item.cloneNode == "function") {
                  var result = item.cloneNode( true );
              } else if (!item.prototype) { // check that this is a literal
                  if (item instanceof Date) {
                      result = new Date(item);
                  } else {
                      // it is an object literal
                      result = {};
                      for (var i in item) {
                          result[i] = ccBooleanAnalysis._clone( item[i] );
                      }
                  }
              } else {
                  // depending what you would like here,
                  // just keep the reference, or create new object
                  if (false && item.constructor) {
                      // would not advice to do that, reason? Read below
                      result = new item.constructor();
                  } else {
                      result = item;
                  }
              }
          } else {
              result = item;
          }
      }

      return result;
  }

  // Get all values in a dictionary
  ccBooleanAnalysis._getValues = function(dict) {
    var array_values = [];
    for (var key in dict) {
      array_values.push(dict[key]);
    }
    return array_values;
  }

  // Get all values from a dictionary and flatten them
  // Ex. {
  //  'AB': [  [1], [2], [3]  ]
  //  'C':  [  [4], [5] ]
  // }
  //
  // Produces:
  // [ [1], [2], [3], [4], [5] ]
  //
  // If _getValues was used, it would instead produce:
  // [ [ [1],[2],[3] ], [ [4], [5] ] ]
  //
  //
  ccBooleanAnalysis._getValuesFlattened = function(dict) {
    var array_values = [];
    for (var key in dict) {
      var value_arr = dict[key];
      for (var i = 0; i < value_arr.length; i++) {
        array_values.push(value_arr[i]);
      }
    }
    return array_values;
  }

  // Get all keys in a dictionary
  ccBooleanAnalysis._getKeys = function(dict) {
    var array_keys = [];
    for (var key in dict) {
      array_keys.push(key);
    }
    return array_keys;
  }

  // Return unique vlaues
  // use as follows:
  // data.filter(ccBooleanAnalysis._uniqueFilter)
  ccBooleanAnalysis._uniqueFilter = function(value, index, self) {
    return self.indexOf(value) == index;
  }

  // Boolean
  // do two arrays share a common term?
  ccBooleanAnalysis._shares_term = function(a, b) {
    var ai=0, bi=0;
    var result = [];

    while(ai < a.length && bi < b.length)
    {
       if      (a[ai] < b[bi]){ ai++; }
       else if (a[ai] > b[bi]){ bi++; }
       else /* they're equal */
       {
        return true;
       }
    }

    return false;
  }

  // Removes shared variables from two arrays and returns them
  // in a new array.
  // Input must be sorted.
  // Output is sorted.
  ccBooleanAnalysis._remove_intersection = function(a, b) {
    var ai=0, bi=0;
    var result = [];

    while(ai < a.length && bi < b.length)
    {
       if      (a[ai] < b[bi]){ ai++; }
       else if (a[ai] > b[bi]){ bi++; }
       else /* they're equal */
       {
         result.push(a[ai]);
         a.splice(ai, 1);
         b.splice(bi, 1);
       }
    }

    return result;
  }

  // Returns the union of two arrays
  // Input must be sorted.
  // Output is sorted.
  ccBooleanAnalysis._get_union = function(a, b) {
    var ai=0, bi=0;
    var result = [];

    while(ai < a.length && bi < b.length)
    {
       if      (a[ai] < b[bi]){ result.push(a[ai]); ai++; }
       else if (a[ai] > b[bi]){ result.push(b[bi]); bi++; }
       else /* they're equal */
       {
         result.push(a[ai]);
         ai++;
         bi++;
       }
    }

    while (ai < a.length)
    {
      result.push(a[ai]);
      ai++;
    }

    while (bi < b.length)
    {
      result.push(b[bi]);
      bi++;
    }

    return result;
  }

  // Find the intersection of two arrays without modifying
  // those arrays.
  // Input must be sorted.
  // Output is sorted.
  ccBooleanAnalysis._get_intersection = function(a, b) {
    var ai=0, bi=0;
    var result = [];

    while(ai < a.length && bi < b.length)
    {
       if      (a[ai] < b[bi]){ ai++; }
       else if (a[ai] > b[bi]){ bi++; }
       else /* they're equal */
       {
         result.push(a[ai]);
         ai++;
         bi++;
       }
    }

    return result;
  }

  // Is a a subset of b?
  // Is b a subset of a?
  //
  // returns:
  // 0 - no subsets
  // 1 - a is subset of b (a < b)
  // 2 - b is subset of a (b < a)
  ccBooleanAnalysis._is_subset = function(a, b) {
    var intersection_len = this._get_intersection(a, b).length;
    if (a.length === intersection_len) {
      return 1;
    } else if (b.length === intersection_len) {
      return 2;
    }
    return 0;
  }

  ////////////////////////////////////////
  ////////////////////////////////////////
  ////  Restructure Boolean Expressions
  ////
  ////////////////////////////////////////
  ////////////////////////////////////////

  ccBooleanAnalysis._constructNegation = function(parse_tree) {
    return {
      argument: parse_tree,
      operator: this._constants.kNOT,
      prefix: true,
      type: this._constants.kUnaryExpression
    };
  }

  ccBooleanAnalysis._constructAND = function(left, right) {
    return {
      left: left,
      right: right,
      operator: this._constants.kAND,
      type: this._constants.kBinaryExpression
    };
  }

  // Negate an expression
  ccBooleanAnalysis._negate = function(parse_tree) {
    if (parse_tree.type == this._constants.kIdentifier) {
      return this._constructNegation(parse_tree);
    } else if (parse_tree.operator == this._constants.kNOT) {
      return parse_tree.argument;
    } else if (parse_tree.operator == this._constants.kOR) {
      parse_tree.operator = this._constants.kAND;
      parse_tree.left = this._negate(parse_tree.left);
      parse_tree.right = this._negate(parse_tree.right);
      return parse_tree;
    } else if (parse_tree.operator == this._constants.kAND) {
      parse_tree.operator = this._constants.kOR;
      parse_tree.left = this._negate(parse_tree.left);
      parse_tree.right = this._negate(parse_tree.right);
      return parse_tree;
    }
  }

  // Applies demorgan's rule for non-trivial cases
  ccBooleanAnalysis._convertToNegationForm = function(parse_tree) {
    if (parse_tree.type == this._constants.kIdentifier) {
      return;
    } else if (parse_tree.operator == this._constants.kNOT) {
      // Copy the argument's negation into the parse tree
      if (parse_tree.argument.type == this._constants.kIdentifier) {
        return;
      } else {
        new_parse_tree = this._negate(parse_tree.argument);
        for (var k in new_parse_tree) {
          parse_tree[k] = new_parse_tree[k];
        }
      }
    } else {
      this._convertToNegationForm(parse_tree.left);
      this._convertToNegationForm(parse_tree.right);
    }
  }

  // Distribute ANDs across ORs
  ccBooleanAnalysis._pushDownAnds = function(parse_tree) {
    if (parse_tree.operator == this._constants.kAND) {
      if (parse_tree.right.operator == this._constants.kOR) {
        var old_left = parse_tree.left;
        parse_tree.left = this._constructAND(old_left, parse_tree.right.left);
        parse_tree.right = this._constructAND(old_left, parse_tree.right.right);
        parse_tree.operator = this._constants.kOR;
      }
      else if (parse_tree.left.operator == this._constants.kOR) {
        var old_right = parse_tree.right;
        parse_tree.right = this._constructAND(parse_tree.left.right, old_right);
        parse_tree.left = this._constructAND(parse_tree.left.left, old_right);
        parse_tree.operator = this._constants.kOR;
      }
      this._pushDownAnds(parse_tree.left);
      this._pushDownAnds(parse_tree.right);
    }
    else if (parse_tree.operator == this._constants.kOR) {
      this._pushDownAnds(parse_tree.left);
      this._pushDownAnds(parse_tree.right);
    }
      // Negations and terminals are terminating cases
  }

  // Get all positive and negative variables
  // structure terms as: { data: { positive: [], negative: [] } }
  // Must be in negation form to work properly
  ccBooleanAnalysis._sortTerms = function(parse_tree, terms, label_pos_neg) {
    if (parse_tree.operator == this._constants.kAND || parse_tree.operator == this._constants.kOR) {
      this._sortTerms(parse_tree.left, terms, label_pos_neg);
      this._sortTerms(parse_tree.right, terms, label_pos_neg);
    } else if (parse_tree.type == this._constants.kIdentifier) {
      if (label_pos_neg) {
        terms.data.push(parse_tree.name + '___pos');
      } else {
        terms.data.push(parse_tree.name);
      }
    } else if (parse_tree.operator == this._constants.kNOT) {
      if (label_pos_neg) {
        terms.data.push(parse_tree.argument.name + '___neg');
      } else {
        terms.data.push(parse_tree.argument.name);
      }
    }
  }


  ////////////////////////////////////////
  ////////////////////////////////////////
  ////  State Transition Graphs
  ////
  ////////////////////////////////////////
  ////////////////////////////////////////

  ccBooleanAnalysis._evaluateState = function(expression, regexes) {
    // convert the expression into a parseable form
    // regexes are regular expression forms of the assignments.
    // This function could compute the regexes based on the assignments,
    // but as this function is likely to be called many times with the same assignment,
    // the function requests precomputed regexes.
    //
    // These regexes can be generated with ccBooleanAnalysis._getRegexes(assignments).
    var mapObj = {
      'OR':'||',
      'AND':'&&',
      '~':'!'
    };

    var parsable_expression = expression.replace(/AND|OR|~/gi, function(matched){
      return mapObj[matched];
    });

    // insert the assignments into the parsable_expression
    parsable_expression = this._applyRegexes(parsable_expression, regexes);
    return eval(parsable_expression);
  }

  ccBooleanAnalysis._applyRegexes = function(parsable_expression, regexes) {
    // This expression should be parsable (i.e. have &&, ||, etc.)
    // regexes / assignments should be generated using ccBooleanAnalysis._getRegexes.
    // This function applies those regexes to an expression.
    for (var i = 0; i < regexes.length; i++) {
      var regex = regexes[i];

      parsable_expression = parsable_expression.replace(regex[0], regex[1]);
    }
    return parsable_expression;
  }

  ccBooleanAnalysis._getRegexes = function(assignments) {
    // generate the appropriate regular expressions that can be applied
    // to a parseable expression so that an evaluation gives the updated
    // state of the term.
    //
    // Note that assignments should be a hashmap where keys are the
    // the variables; and values are booleans of the desired state.
    //
    // Each term of the array includes another array.
    // The first term of this inner array is the regular expression.
    // The second term of the array is the assignment that should be made.
    // The assignment is represented as a boolean.
    var regexes = [];
    for (key in assignments) {
      var assignment = assignments[key];
      var re = new RegExp(key, 'g');
      regexes.push([re, assignment.toString()]);
    }
    return regexes;
  }

  ccBooleanAnalysis.evaluateStateTransition = function(equations, assignments) {
    var regexes = this._getRegexes(assignments);
    var new_assignments = {};
    for (var i = 0; i < equations.length; i++) {
      var equation = equations[i];
      var sides = equation.split('=');
      new_assignments[sides[0]] = this._evaluateState(sides[1], regexes);
    }

    return new_assignments;
  }

  ccBooleanAnalysis.stateTransitionGraph = function(equations) {
    // First, grab all the terms in the equations.
    var terms = [];
    for (var i = 0; i < equations.length; i++) {
      var equation = equations[i];
      terms.push(equation.split('=')[0]);
    }

    // Iterate through each possible combination of assignments
    // transitions is an array.
    // each element is an array of length 2.
    // The first entry is the starting assignments.
    // The second entry is the ending assignments.
    var transitions = [];

    // In order to compute the truth table, we count
    // to 2^(equations.length - 1) in binary.
    // Each digit of this binary expression gives the setting
    // of a term in the evaluation.
    for (var i = 0; i < (2 << equations.length); i++) {
      var settings = i.toString(2);
      var assignments = {};
      for (var j = 0; j < terms.length; j++) {
        var term = terms[j];
        if (j < settings.length) {
          if (settings[j] == 1) {
            assignments[term] = true;
          } else {
            assignments[term] = false;
          }
        } else {
          assignments[term] = false;
        }
      }
      var new_assignments = this.evaluateStateTransition(equations, assignments);
      transitions.push([assignments, new_assignments]);
    }

    return transitions;
  }

  ////////////////////////////////////////
  ////////////////////////////////////////
  ////        Attractor Search
  ////
  ////////////////////////////////////////
  ////////////////////////////////////////
  ccBooleanAnalysis.attractorSearchExhaustive = function(equations) {
    var st_graph = ccBooleanAnalysis.stateTransitionGraph(equations);



    console.log("st_graph");
    console.log(st_graph);
    console.log("JSON.stringify(st_graph[0])");
    console.log(JSON.stringify(st_graph[0]));

  }

  ccBooleanAnalysis.attractorSearchHeuristic = function(equations, num_runs, depth) {
    var attractors = [];
    var st_graph = ccBooleanAnalysis.stateTransitionGraph(equations);

    for (i = 0; i < num_runs; i++) {
      random_idx = Math.floor((Math.random() * st_graph.length));
      c_i = st_graph[st_graph];
    }
  }

  ////////////////////////////////////////
  ////////////////////////////////////////
  ////         Satisfiability
  ////
  ////////////////////////////////////////
  ////////////////////////////////////////

  // returns a Logic (logic-solver) encoding of the parse_tree
  // recursively builds the encoding
  // does not require DNF or any fancy expresion
  ccBooleanAnalysis._buildLogicFormula = function(parse_tree) {
    if (parse_tree.type == ccBooleanAnalysis._constants.kIdentifier) {
      // base case
      return parse_tree.name;
    } else if (parse_tree.type == ccBooleanAnalysis._constants.kUnaryExpression) {
      return Logic.not(this._buildLogicFormula(parse_tree.argument));
    } else if (parse_tree.operator == ccBooleanAnalysis._constants.kAND) {
      return Logic.and(this._buildLogicFormula(parse_tree.left), this._buildLogicFormula(parse_tree.right));
    } else if (parse_tree.operator == ccBooleanAnalysis._constants.kOR) {
      return Logic.or(this._buildLogicFormula(parse_tree.left), this._buildLogicFormula(parse_tree.right));
    }
  }

  // Is the given formula satisfiable?
  ccBooleanAnalysis._formulaSatisfiable = function(logic_formula) {
    var solver = new Logic.Solver();
    solver.require(logic_formula);
    var result = solver.solve(); // null if not satisfiable
    if (result) {
      return true
    } else {
      return false;
    }
  }

  /**
   * @method ccBooleanAnalysis.satisfiable
   * @param {string} s A string encoding a boolean expression that should be checked for satisfiability.
   * @return {boolean} Whether the expression is satisfiable.
   */
  ccBooleanAnalysis.satisfiable = function(s) {
    var parse_tree = this.getParseTree(s);
    var logic_formula = this._buildLogicFormula(parse_tree);
    return this._formulaSatisfiable(logic_formula);
  }

  /**
   * @method ccBooleanAnalysis.compareBooleansSAT
   * @param {string} s1 A string encoding a boolean expression that should be checked for equality.
   * @param {string} s2 A string encoding a boolean expression that should be checked for equality.
   * @return {boolean} Whether the two expressions are equivalent.
   */
  ccBooleanAnalysis.compareBooleansSAT = function(s1, s2) {
    var pt1 = this.getParseTree(s1);
    var pt2 = this.getParseTree(s2);

    var logic_formula1 = this._buildLogicFormula(pt1);
    var logic_formula2 = this._buildLogicFormula(pt2);

    var expression = Logic.xor(logic_formula1, logic_formula2);
    return !(ccBooleanAnalysis._formulaSatisfiable(expression));
  }


  ////////////////////////////////////////
  ////////////////////////////////////////
  ////         Model Reduction
  ////
  ////////////////////////////////////////
  ////////////////////////////////////////

  // conjuctions is an array of arrays (all values in DNFObject)
  // returns new conjuctions array
  ccBooleanAnalysis.parseConjuctionsAtPoint = function(conjuctions, variable, value) {
    var anything_changed = false;
    for (var i = 0; i < conjuctions.length; i++) {
      var conjuction = conjuctions[i];
      for (var j = 0; j < conjuction[0].length; j++) { // pos variables
        if (conjuction[0][j] == variable) {
          if (value) { // true
            // if there is only one conjuction
            // and that conjuction has just one positive variable
            if (conjuction[0].length == 1 && conjuction[1].length == 0) {
              // this it the only term left in the conjuction,
              // though other conjuctions still remain.
              // But since this conjuction is true, and we only
              // need one conjuction to be true for SAT,
              // we return that the entire expression is true.
              return [true, true, 1];
            } else {
              // delete term
              conjuction[0].splice(j, 1);
              j--;
              anything_changed = true;
            }
          } else { // false
            if (conjuctions.length == 1) {
              // this is the only conjuction left. Report a constant false function.
              return [false, true, -1];
            } else {
              // delete conjuction
              conjuctions.splice(i, 1);
              i--;
              anything_changed = true;
              break;
            }
          }
        }
      }

      for (var j = 0; j < conjuction[1].length; j++) { // neg variables
        if (conjuction[1][j] == variable) {
          if (!(value)) { // true
            // if there is only one conjuction
            // and that conjuction has just one positive variable
            if (conjuction[1].length == 1 && conjuction[0].length == 0) {
              // this it the only term left in the conjuction,
              // though other conjuctions still remain.
              // But since this conjuction is true, and we only
              // need one conjuction to be true for SAT,
              // we return that the entire expression is true.
              return [true, true, 1];
            } else {
              // delete term
              conjuction[1].splice(j, 1);
              j--;
              anything_changed = true;
            }
          } else { // false
            if (conjuctions.length == 1) {
              // this is the only conjuction left. Report a constant false function.
              return [false, true, -1];
            } else {
              // delete conjuction
              conjuctions.splice(i, 1);
              i--;
              anything_changed = true;
              break;
            }
          }
        }
      }
    }
    return [conjuctions, anything_changed, 0];
    // last item in array is whether this thing is a constant term
    // -1 -> constant false
    // 1 ->  constant true
    // 0 -> not constant
  }

  // accepts equations as an array of strings
  // dependent_on and depends_on will change overtime,
  // but the beginning values still serve as a good heuristic
  // on what to analyze
  //
  // future: find data structure which lets us look up where a value in within
  // the hashtable and remove it (quickly).
  ccBooleanAnalysis.reduceModel = function(equations) {
    var equation_mapping = {}; // equation_mapping['A'] gives array of arrays of conjuctions for expr in A=(expr)
    var depends_on = {}; // depends_on['A'] gives all variables which depend on 'A'.
    var constant_term_pos = [];
    var constant_term_neg = [];
    // can derive dependent_on from equation_mapping (a flattening of the outer array in equation_mapping)

    // prepare those dictionaries
    for (var i = 0; i < equations.length; i++) {
      var equation = equations[i];
      var parts = equation.split('=');

      // Clear white space from the LHS
      parts[0] = parts[0].replace(/ /gi, "");

      // Example format of conjuctions:
      // [ [ [ 'A' ], [ 'D' ] ], [ [ 'C' ], [] ] ]
      var conjuctions = this._getValuesFlattened(this.getDNFObjectEncoding(parts[1]));

      // First, propogate any 'true' and 'false' values that are baked in.
      var result_at_point = this.parseConjuctionsAtPoint(conjuctions, 'true', true);
      if (result_at_point[2] == 1) {
        constant_term_pos.push(parts[0]);
        continue;
      } else if (result_at_point[2] == -1) {
        constant_term_neg.push(parts[0]);
        continue;
      }

      result_at_point = this.parseConjuctionsAtPoint(result_at_point[0], 'false', false);
      if (result_at_point[2] == 1) {
        constant_term_pos.push(parts[0]);
        continue;
      } else if (result_at_point[2] == -1) {
        constant_term_neg.push(parts[0]);
        continue;
      }

      // Then, set up the depends_on matrix
      equation_mapping[parts[0]] = conjuctions;
      for (var j = 0; j < conjuctions.length; j++) {
        var individual_conjuction = conjuctions[j];
        for (var k = 0; k < individual_conjuction[0].length; k++) {
          var term = individual_conjuction[0][k];
          if (!(term in depends_on)) {
            depends_on[term] = [];
          }
          depends_on[term].push(parts[0]);
        }

        for (var k = 0; k < individual_conjuction[1].length; k++) {
          var term = individual_conjuction[1][k];
          if (!(term in depends_on)) {
            depends_on[term] = [];
          }
          depends_on[term].push(parts[0]);
        }
      }
    }

    // Reduction Algorithm 1
    // Identifying and eliminating the stabilized nodes
    // See section 2.1 of Saadatpour, et al.

    // We optimize the algorithm by finding all constant functions in advance
    // and noting that a non-constant function can only become constant
    // if it depends on a constant function.
    //
    // This way, we can determine that we are at a fixed point a priori without
    // actually confirming this (saves O(N) time).

    for (var i = 0; i < constant_term_pos.length; i++) {
      var term = constant_term_pos[i];
      var dependencies = depends_on[term]; // A = B AND C ->>>>> A depends on B. A shows up in dependencies.
      for (var j = 0; j < dependencies.length; j++) {
        var dependency = dependencies[j];
        if (!(dependency in equation_mapping)) { // meaning it hasn't been removed yet by becoming constant...
          continue;
        }
        var conjuctions = equation_mapping[dependency];
        var result_at_point = this.parseConjuctionsAtPoint(conjuctions, term, true);

        if (result_at_point[2] == 1) {
          constant_term_pos.push(dependency);
          delete equation_mapping[dependency];
          continue;
        } else if (result_at_point[2] == -1) {
          constant_term_neg.push(dependency);
          delete equation_mapping[dependency];
          continue;
        } else {
          equation_mapping[dependency] = result_at_point[0];
        }
      }
    }

    // Basically same code for negatives
    for (var i = 0; i < constant_term_neg.length; i++) {
      var term = constant_term_neg[i];
      var dependencies = depends_on[term];
      for (var j = 0; j < dependencies.length; j++) {
        var dependency = dependencies[j];
        if (!(dependency in equation_mapping)) { // meaning it hasn't been removed yet by becoming constant...
          continue;
        }
        var conjuctions = equation_mapping[dependency];
        var result_at_point = this.parseConjuctionsAtPoint(conjuctions, term, false);

        if (result_at_point[2] == 1) {
          constant_term_pos.push(dependency);
          delete equation_mapping[dependency];
          continue;
        } else if (result_at_point[2] == -1) {
          constant_term_neg.push(dependency);
          delete equation_mapping[dependency];
          continue;
        } else {
          equation_mapping[dependency] = result_at_point[0];
        }
      }
    }

    // Reduction Algorithm 2
    // Merging simple mediator nodes
    // See section 2.1 of Saadatpour, et al.

    // a -> b -> c ------> a -> c
    var inDegreeOneDependency = function(eq_conjuctions) {
      // returns false if the in-degree is > 1
      // otherwise, returns the dependency, whether the term is pos (True) / neg (False)

      // If there are multiple conjuctions, there must be
      // multiple variables. Becuase otherwise, these variables
      // would have been removed in a pre-processing step.
      // I.e. we would never see (A OR NOT A).
      // We might see (A OR (NOT A AND B)),
      // but the in-degree is >1 here.
      if (eq_conjuctions.length > 1) {
        return false;
      }
      // If there are variables in both the true and false sections
      // of the conjuction, then in-degree must be > 1.
      else if (eq_conjuctions[0][0].length + eq_conjuctions[0][1].length > 1) {
        return false;
      }
      // there is one variable in the positive section
      else if (eq_conjuctions[0][0].length == 1 && eq_conjuctions[0][1].length == 0) {
        return [eq_conjuctions[0][0][0], true];
      }
      // there is one variable in the negative section
      else if (eq_conjuctions[0][0].length == 0 && eq_conjuctions[0][1].length == 1) {
        return [eq_conjuctions[0][1][0], false];
      }
    }

    // If a term is in in_degree_one_mat, then it has in_degree_one.
    // It's value in the hash_map is [its_dependency, pos/neg reliance]
    in_degree_one_mat = {};
    for (var term in equation_mapping) {
      var result = inDegreeOneDependency(equation_mapping[term]);
      if (result) {
        in_degree_one_mat[term] = result;
      }
    }

    // Find mediator nodes
    for (var term in in_degree_one_mat) {
      // keep_going allows us to keep collapsing terms
      // until the chain ends
      var keep_going = true;
      while (keep_going) {
        var back_dependency_1_info = in_degree_one_mat[term];
        if (back_dependency_1_info[0] in in_degree_one_mat) {
          var back_dependency_2_info = in_degree_one_mat[back_dependency_1_info[0]];

          // Update the chain
          if (back_dependency_1_info[1] == back_dependency_2_info[1]) { // true/true of false/false gives positive
            equation_mapping[term] = [ [ [ back_dependency_2_info[0] ], [] ] ];
            in_degree_one_mat[term] = [back_dependency_2_info[0], true];
          } else {
            equation_mapping[term] = [ [ [], [ back_dependency_2_info[0] ] ] ];
            in_degree_one_mat[term] = [back_dependency_2_info[0], false];
          }

          // Remove the mediator node
          delete equation_mapping[back_dependency_1_info[0]];
          delete in_degree_one_mat[back_dependency_1_info[0]];
        } else {
          // if there is no mediator node, move onto the next term
          keep_going = false;
        }
      }
    }

    // returns a hash_table representing the conjuctions for each term
    // can be interconverted into parse_tree or similar, as needed.
    return equation_mapping;
  }

  module.exports = ccBooleanAnalysis;
// });
