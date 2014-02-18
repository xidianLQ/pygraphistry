define(["Q", "util", "cl"], function(Q, util, cljs) {
	Q.longStackSupport = true;
	var randLength = 73;

	function create(renderer, dimensions, numSplits) {
		return cljs.create(renderer.gl)
		.then(function(cl) {
			// Compile the WebCL kernels
			return util.getSource("apply-forces.cl")
			.then(function(source) {
				return cl.compile(source, ["apply_points", "apply_springs"]);
			})
			.then(function(kernels) {
				var simObj = {
					"renderer": renderer,
					"cl": cl,
					"pointKernel": kernels["apply_points"],
					"edgesKernel": kernels["apply_springs"],
					"elementsPerPoint": 2
				};
				simObj.tick = tick.bind(this, simObj);
				simObj.setPoints = setPoints.bind(this, simObj);
				simObj.setEdges = setEdges.bind(this, simObj);
				simObj.setPhysics = setPhysics.bind(this, simObj);
				simObj.dimensions = dimensions;
				simObj.numSplits = numSplits;
				simObj.numPoints = 0;
				simObj.numEdges = 0;
				simObj.events = {
					"kernelStart": function() { },
					"kernelEnd":  function() { },
					"bufferCopyStart": function() { },
					"bufferCopyEnd": function() { },
					"bufferAquireStart": function() { },
					"bufferAquireEnd": function() { }
				};
				simObj.buffers = {};

				console.debug("WebCL simulator created");
				return simObj
			});
		})

	}


	function setPoints(simulator, points) {
		if(points.length % simulator.elementsPerPoint !== 0) {
			throw new Error("The points buffer is an invalid size (must be a multiple of " + simulator.elementsPerPoint + ")");
		}

		return Q.all([simulator.buffers.nextPoints, simulator.buffers.randValues, simulator.buffers.curPoints]
		.filter(function(val) { return !(!val); }).map(function(val) { return val.delete(); }))
		.then(function() {
			simulator.buffers.nextPoints = null;
			simulator.buffers.randValues = null;
			simulator.buffers.curPoints = null;

			simulator.numPoints = 0;
			simulator.renderer.numPoints = 0;

			if(simulator.renderer.buffers.curPoints) {
				return simulator.renderer.buffers.curPoints.delete()
				.then(function() {
					simulator.renderer.buffers.curPoints = null;
				})
			} else {
				return null;
			}
		})
		.then(function() {
			simulator.numPoints = points.length / simulator.elementsPerPoint;
			simulator.renderer.numPoints = simulator.numPoints;

			// If there are 0 points, then don't create any of the buffers
			if(simulator.numPoints < 1) {
				throw "zero-points";
			}

			console.debug("Number of points:", simulator.renderer.numPoints);

			// Create buffers and write initial data to them, then set
			return Q.all([simulator.renderer.createBuffer(points),
				   simulator.cl.createBuffer(points.length * simulator.elementsPerPoint * points.BYTES_PER_ELEMENT),
				   simulator.cl.createBuffer(randLength * simulator.elementsPerPoint * Float32Array.BYTES_PER_ELEMENT)])
		})
		.spread(function(pointsVBO, nextPointsBuffer, randBuffer) {
			simulator.renderer.buffers.curPoints = pointsVBO;
			simulator.buffers.nextPoints = nextPointsBuffer;
			simulator.buffers.randValues = randBuffer;

			var rands = new Float32Array(randLength * simulator.elementsPerPoint);
			for(var i = 0; i < rands.length; i++) {
				rands[i] = Math.random();
			}

			return Q.all([simulator.cl.createBufferGL(pointsVBO), simulator.buffers.randValues.write(rands)]);
		})
		.spread(function(pointsBuf, randValues) {
			simulator.buffers.curPoints = pointsBuf;

			var types = [];
			if(!cljs.CURRENT_CL) {
				// FIXME: find the old WebCL platform type for float2
				types = [cljs.types.int_t, null, null , cljs.types.local_t, cljs.types.float_t, cljs.types.float_t, cljs.types.float_t, cljs.types.float_t, null, cljs.types.uint_t];
			}

			var localPos = Math.min(simulator.cl.maxThreads, simulator.numPoints) * simulator.elementsPerPoint * Float32Array.BYTES_PER_ELEMENT;
			return simulator.pointKernel.setArgs(
			    [new Int32Array([simulator.numPoints]),
			     simulator.buffers.curPoints.buffer,
			     simulator.buffers.nextPoints.buffer,
			     new Uint32Array([localPos]),
			     new Float32Array([simulator.dimensions[0]]),
			     new Float32Array([simulator.dimensions[1]]),
			     new Float32Array([-0.00001]),
			     new Float32Array([0.2]),
			     simulator.buffers.randValues.buffer,
			     new Uint32Array([0])],
				types);
		})
		.then(function() {
			return simulator;
		}, function(err) {
			if(err === "zero-points") {
				return simulator;
			} else {
				throw err;
			}
		})
	}


	/**
	 * Sets the edge list for the graph
	 *
	 * @param simulator - the simulator object to set the edges for
	 * @param {Uint32Array} edges - buffer where every two items contain the index of the source
	 *        node for an edge, and the index of the target node of the edge.
	 * @param {Uint32Array} workItems - buffer where every two items encode information needed by
	 *         one thread: the index of the first edge it should process, and the number of
	 *         consecutive edges it should process in total.
	 * @param {Float32Array} midPoints - 
	 * @returns {Q.promise} a promise for the simulator object
	 */
	function setEdges(simulator, edges, workItems, midPoints) {
		var elementsPerEdge = 2; // The number of elements in the edges buffer per spring
		var elementsPerWorkItem = 2;

		// Delete all the existing edge buffers
		return Q.all([simulator.buffers.edges, simulator.buffers.workItems, simulator.buffers.springsPos]
		.filter(function(val) { return !(!val); }).map(function(val) { return val.delete(); }))
		.then(function() {
			simulator.buffers.edges = null;
			simulator.buffers.workItems = null;
			simulator.buffers.springsPos = null;

			simulator.numEdges = 0;
			simulator.renderer.numEdges = 0;
			simulator.numWorkItems = 0;

			if(simulator.renderer.buffers.springs) {
				return simulator.renderer.buffers.springs.delete()
				.then(function() {
					simulator.renderer.buffers.springs = null;
				})
			} else {
				return null;
			}
		})
		.then(function() {
			if(edges.length % elementsPerEdge !== 0) {
				throw new Error("The edge buffer size is invalid (must be a multiple of " + elementsPerEdge + ")");
			}
			if(workItems.length % elementsPerWorkItem !== 0) {
				throw new Error("The work item buffer size is invalid (must be a multiple of " + elementsPerWorkItem + ")");
			}

			simulator.numEdges = edges.length / elementsPerEdge;
			simulator.renderer.numEdges = simulator.numEdges;
			simulator.numWorkItems = workItems.length / elementsPerWorkItem;
		})
		.then(function() {
			return Q.all([simulator.cl.createBuffer(edges.length * elementsPerEdge * edges.BYTES_PER_ELEMENT),
			          simulator.cl.createBuffer(workItems.length * elementsPerWorkItem * workItems.BYTES_PER_ELEMENT),
			          simulator.renderer.createBuffer(edges.length * 2 * elementsPerEdge * Float32Array.BYTES_PER_ELEMENT)])
		})
		.spread(function(edgesBuffer, workItemsBuffer, springsVBO) {
			simulator.buffers.edges = edgesBuffer;
			simulator.buffers.workItems = workItemsBuffer;
			simulator.renderer.buffers.springs = springsVBO;

			return Q.all([simulator.cl.createBufferGL(springsVBO),
				          simulator.buffers.edges.write(edges),
						  simulator.buffers.workItems.write(workItems)]);
		})
		.spread(function(springsBuffer, _, _) {
			simulator.buffers.springsPos = springsBuffer;

			var types = [];
			if(!cljs.CURRENT_CL) {
				types = [null, null, null , null, null, cljs.types.float_t, cljs.types.float_t];
			}

			var localPos = Math.min(simulator.cl.maxThreads, simulator.numPoints) * simulator.elementsPerPoint * Float32Array.BYTES_PER_ELEMENT;
			return simulator.edgesKernel.setArgs(
			    [simulator.buffers.edges.buffer,
			     simulator.buffers.workItems.buffer,
			     simulator.buffers.nextPoints.buffer,
			     simulator.buffers.curPoints.buffer,
			     simulator.buffers.springsPos.buffer,
			     // new Float32Array([0.2]),
			     // new Float32Array([40])
			     new Float32Array([1.0]),
			     new Float32Array([0.1])
			     ],
				types);
		});
	}


	function setPhysics(simulator, cfg) {
	    cfg = cfg || {};

	    if(cfg.charge || cfg.gravity) {
		    var charge = cfg.charge ? new Float32Array([cfg.charge]) : null;
		    var charge_t = cfg.charge ? cljs.types.float_t : null;

		    var gravity = cfg.gravity ? new Float32Array([cfg.gravity]) : null;
		    var gravity_t = cfg.gravity ? cljs.types.float_t : null;

		    simulator.pointKernel.setArgs(
		     [null, null, null, null, null, null,
		         charge, gravity, null, null],
		     [null, null, null, null, null, null,
		         charge_t, gravity_t, null, null]
		     );
		}

		if(cfg.edgeDistance || cfg.edgeStrength) {
			var edgeDistance = cfg.edgeDistance ? new Float32Array([cfg.edgeDistance]) : null;
			var edgeDistance_t = cfg.edgeDistance ? cljs.types.float_t : null;

			var edgeStrength = cfg.edgeStrength ? new Float32Array([cfg.edgeStrength]) : null;
			var edgeStrength_t = cfg.edgeStrength ? cljs.types.float_t : null;

			simulator.edgesKernel.setArgs(
				[null, null, null, null, null, edgeStrength, edgeDistance],
				[null, null, null, null, null, edgeStrength_t, edgeDistance_t]);
		}
	}


	function tick(simulator, stepNumber) {
		// If there are no points in the graph, don't run the simulation
		if(simulator.numPoints < 1) {
			return Q.fcall(function() { simulator; });
		}

	    simulator.pointKernel.setArgs(
	     [null, null, null, null, null, null, null, null, null, new Uint32Array([stepNumber])],
	     [null, null, null, null, null, null, null, null, null, cljs.types.uint_t]
	     );


		simulator.events.bufferAquireStart();

		return Q.all([simulator.buffers.curPoints.acquire()])
		.then(function() {
			simulator.events.bufferAquireEnd();
			simulator.events.kernelStart();

			return simulator.pointKernel.call(simulator.numPoints, []);
		})
		.then(function() {
			simulator.events.kernelEnd();
			simulator.events.bufferCopyStart();

			// We have to copy the buffer explicitly because the springs kernel only copies the
			// points that are connected by spring from nextPoints to curPoints.
			return simulator.buffers.nextPoints.copyBuffer(simulator.buffers.curPoints);
		})
		.then(function() {
			simulator.events.bufferCopyEnd();

			if(simulator.numEdges > 0) {
				simulator.events.kernelStart();

				simulator.edgesKernel.setArgs(
				 [null, null, null, null, null, null, null, new Uint32Array([stepNumber])],
				 [null, null, null, null, null, null, null, cljs.types.uint_t]
				 );

				return simulator.edgesKernel.call(simulator.numWorkItems, [])
				.then(function() {
					simulator.events.kernelEnd();
					return simulator;
				})
			} else {
				return simulator;
			}
		})
		.then(function() {
			simulator.events.bufferAquireStart();
			return Q.all([simulator.buffers.curPoints.release()]);
		})
		.then(function() {
			simulator.events.bufferAquireEnd();
			// TODO: Use a callback argument to finish(), rather than letting it block when we don't
			// provide one.
			simulator.cl.queue.finish();
			return simulator;
		});
	}


	return {
		"create": create,
		"setPoints": setPoints,
		"setEdges": setEdges,
		"tick": tick
	};
});