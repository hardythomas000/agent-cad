# The Architecture of Token-Native Geometry: Custom Kernels and Agentic Representation in 3D Spatial Intelligence

The advancement of spatial intelligence within the ecosystem of large language models is undergoing a tectonic shift from traditional, externalized geometric processing toward internal, token-native paradigms. This evolution is fundamentally defined by the capacity of transformer-based architectures to treat three-dimensional geometry not as an auxiliary data format to be retrieved or rendered via black-box kernels, but as a primary, lexicalized modality integrated directly into the model's latent space. The transition is catalyzed by the development of custom geometric kernels and token-level representations that allow models to manipulate and produce 3D geometry through autoregressive processes and differentiable optimization loops. By examining the repository hardythomas000/token-native-geometry and contemporary research into the geometry of internal representations, it becomes evident that the future of computer-aided design and manufacturing resides in the ability of models to "think" in spatial manifolds.

## Internal Manifolds and the Geometry of Hidden Token Representations

The foundational premise of token-native geometry begins with the realization that the hidden layers of large language models are not merely processing semantic symbols but are organizing information into complex geometric structures. Research into the internal representations of models such as Llama-3-8B, Mistral-7B, and Pythia-6.9B has revealed that token embeddings exist on high-dimensional manifolds characterized by specific intrinsic dimensions and neighborhood overlap signatures. The project identified in the hardythomas000/token-native-geometry repository utilizes observables such as cosine similarity, intrinsic dimension, and neighborhood overlap to quantify how these models represent structured information.

The intrinsic dimension of a point cloud formed by token representations in a given hidden layer provides a measure of the effective degrees of freedom the model employs to encode data at that stage of processing. Using the Generalized Ratio Intrinsic Dimension Estimator (GRIDE), implemented through the DADApy library, researchers have observed that these dimensions fluctuate significantly across the depth of the transformer. In the initial layers, the intrinsic dimension is typically higher, reflecting the raw, high-entropy state of input tokens. As the sequence progresses through intermediate layers, the dimension often collapses, indicating the crystallization of semantic and geometric relationships into lower-dimensional manifolds where the model performs its core reasoning.

| Layer Type | Observed Intrinsic Dimension Trend | Geometric Significance |
|---|---|---|
| Embedding Layer | High (Maximum Entropy) | Raw feature representation without semantic pruning. |
| Early Hidden Layers | Moderate-High | Initial feature extraction and contextualization. |
| Mid Hidden Layers | Low (Manifold Collapse) | Extraction of abstract concepts and geometric invariants. |
| Final Hidden Layers | Variable (Task Dependent) | Preparation for next-token prediction or cross-modal projection. |

Neighborhood overlap (NO) further elucidates the stability of these representations. By comparing the k-nearest neighbors of tokens across successive layers, one can determine if the model is maintaining a consistent topological structure for a given set of concepts. In the context of 3D geometry, high neighborhood overlap across deep layers suggests that the model has formed a robust internal "map" of the spatial primitives it is manipulating. For instance, if tokens representing a "cylindrical face" and its "adjacent edges" maintain proximity throughout the transformation blocks, the model is effectively preserving the topological integrity of the B-Rep (Boundary Representation) structure it is processing.

## Custom Geometric Kernels and the Differentiable Paradigm

A critical barrier to progress in neural 3D modeling has been the reliance on standard industry kernels such as Parasolid or ACIS. These kernels, while precise, are fundamentally non-differentiable, acting as "black boxes" that prevent the backpropagation of gradients from the 3D output back to the model's weights. The development of custom, differentiable geometric kernels represents a move toward "agent-native" geometry, where the kernel is an integrated component of the neural architecture rather than an external tool.

### Functional Representations and Neural Occupancy

Unlike traditional kernels that define geometry through exact parametric equations, custom neural kernels often utilize functional representations such as neural occupancy fields or signed distance functions (SDF). In this paradigm, a 3D shape is represented as a continuous function f(x, y, z) → ℝ, where the output indicates whether a given coordinate is inside or outside the solid. This approach offers arbitrary spatial resolution and allows the model to handle heterogeneous geometry with varied levels of detail without a fixed sampling rate.

A significant breakthrough in this area is the introduction of the differentiable rasterizer. This component acts as a bridge between the model's latent codes and a 3D visualization or physical analysis. By training a network to reconstruct 3D geometry from a compact B-Rep format using a differentiable rasterizer, the model learns the geometric evaluation function itself. This self-supervision task allows the model to "interpret" B-Reps geometrically, identifying surfaces and boundaries without requiring manually labeled datasets.

| Kernel Type | Method of Interpretation | Mathematical Foundation | Integration with ML |
|---|---|---|---|
| Traditional (e.g., Parasolid) | Analytic Geometry | Parametric Equations | Non-Differentiable (External) |
| Custom Neural Kernel | Functional Mapping | Neural Occupancy / SDF | Fully Differentiable (Internal) |
| Spectral Kernel | Graph Signal Processing | Laplace-Beltrami Operator | Topological Consistency |

The mathematical formulation of the neural occupancy field is often expressed as:

```
f(p, z) = σ(MLP(p, z))
```

where p is a 3D point, z is a latent geometry token, and σ is an activation function representing the probability of occupancy. Because this formulation is differentiable with respect to the latent code z, the model can optimize the shape parameters of a 3D object to satisfy specific constraints, such as minimizing mass or fitting within a complex assembly, using standard gradient descent.

### Spectral-Preserving Tokenization and Structural Encoding

For unstructured 3D data such as meshes and point clouds, tokenization becomes significantly more complex than for text or images due to the lack of a canonical ordering. Custom geometric kernels address this by employing spectral-preserving tokenization rooted in algebraic multigrid methods. By treating the mesh as a graph M = (V, E) and utilizing the Laplace-Beltrami Operator (LBO), these kernels can extract features that are invariant to isometric transformations—meaning the model recognizes the shape even if it is deformed or rotated.

The LBO provides a set of eigenvalues and eigenfunctions (Φ, Λ) that describe the intrinsic vibrations of the mesh. A common structural encoding used in these kernels is the Heat Kernel Signature (HKS), defined as:

```
HKS(x, t) = Σᵢ exp(-λᵢt) φᵢ(x)²
```

This signature allows the model to attend to specific patches of the mesh with an awareness of the global topological structure, alleviating the quadratic complexity of global self-attention by using localized, spectral-aware patches.

## Tokenization of Boundary Representations (B-Rep)

The Boundary Representation (B-Rep) is the de facto standard for industrial CAD, yet its hierarchical and heterogeneous nature makes it notoriously difficult to tokenize for transformers. B-Reps consist of topological entities (vertices, edges, faces) linked to geometric primitives (points, curves, surfaces). Recent frameworks such as BrepARG and BrepGPT have pioneered the lexicalization of B-Reps, converting them into holistic token sequences suitable for autoregressive modeling.

### Hierarchy and Sequence Construction

Token-native B-Rep modeling requires a serialization strategy that preserves the complex interdependence between geometry and topology. BrepARG, for instance, encodes a B-Rep into three primary token types:

- **Geometry Tokens:** Each face and edge is sampled and encoded via a VQ-VAE into discrete codebook indices representing the local shape.
- **Position Tokens:** The axis-aligned bounding box of each primitive is quantized into scalar bins to provide spatial grounding.
- **Face-Index Tokens:** These tokens explicitly represent the adjacency graph, allowing the model to "point" to other entities in the sequence to define topological connectivity.

To enhance autoregressive learning, faces are often serialized using a topological locality-preserving order, such as a depth-first search (DFS) of the face adjacency graph. This ensures that adjacent topological entities are placed close together in the transformer's context window, allowing the attention mechanism to capture the "edge-counters-surface" priors that are essential for producing watertight 3D models.

| B-Rep Entity | Geometric Primitive | Tokenized Feature | Role in Generation |
|---|---|---|---|
| Face | Parametric Surface | VQ-VAE Indices | Defines the "skin" of the solid. |
| Edge | Parametric Curve | VQ-VAE Indices | Defines the boundaries and intersections. |
| Vertex | 3D Point | Quantized Coordinates | Defines the terminal points of edges. |
| Loop | Edge Chain | Index References | Defines internal or external boundaries on a face. |

The objective of the B-Rep transformer is to minimize the negative log-likelihood of the token sequence:

```
L = -Σₜ log P(xₜ | x₁, ..., xₜ₋₁; θ)
```

By predicting the next geometric or topological token, the model effectively "assembles" the 3D part in a single forward pass, eliminating the error accumulation inherent in the multi-stage pipelines of prior approaches.

### Decoupling Topology from Geometry

One of the most significant challenges in token-native geometry is the "misalignment" between geometry and topology. If a model generates an edge that does not perfectly coincide with the intersection of two faces, the resulting model is "un-watertight" and unsuitable for manufacturing. Advanced frameworks like DTGBrepGen address this by decoupling the two processes.

In a decoupled framework, the model first generates a valid topological structure—an abstract graph of connectivity—before using a transformer-based diffusion model to "populate" that graph with precise geometric attributes like B-spline curves and surfaces. This approach ensures that the fundamental structural integrity of the object is established before the model attempts to solve the complex task of geometric parameterization.

## Agent-Native CAM and Toolpath Generation at the Token Level

The ultimate goal of token-native geometry is the realization of "agent-native" manufacturing, where large language models directly generate and verify the instructions required for physical production. This moves beyond generative design into Computer-Aided Manufacturing (CAM), where the model acts as the primary agent coordinating tool selection, feed rates, and toolpath generation.

### Gemini 3 Deep Think and Tokenized Toolpaths

Recent developments in engineering-specific reasoning models, such as Gemini 3 Deep Think, have introduced a "science/engineering reasoning mode" capable of solving PhD-level physics and math problems associated with manufacturing. Central to this capability is the use of tokenized toolpaths—compact, machine-readable representations of CNC (Computer Numerical Control) or 3D printing instructions that the model can generate and verify in its latent space.

By using tokenized toolpaths, the model can perform "test-time compute heavy" operations, effectively "thinking" through the manufacturing process to identify potential issues like tool breakage or surface quality problems before finalizing the design. This process is reported to be significantly more efficient, with tasks costing 82% less than previous methods while reaching state-of-the-art levels on reasoning benchmarks.

| Feature | Traditional CAM Workflow | Agent-Native CAM (e.g., Gemini 3) |
|---|---|---|
| Interface | Human-operated GUI software. | Direct LLM agent interaction. |
| Reasoning | Human expert heuristics. | PhD-level physics/math reasoning mode. |
| Verification | Manual simulation/checking. | Automated test-time compute verification. |
| Toolpath Format | G-Code files on disk. | Tokenized sequences in latent space. |
| Cost Efficiency | High labor cost / software licenses. | 82% cheaper per engineering task. |

### Model Context Protocol (MCP) and Token Efficiency

To handle the massive amount of data required for complex 3D toolpaths without overwhelming the model's context window, agent-native systems are adopting the Model Context Protocol (MCP). In a standard "naive" architecture, an agent might attempt to load thousands of toolpath coordinates into the context window, leading to "context bloat" and extreme latency.

The token-efficient alternative treats manufacturing tools and data as "code modules." The agent uses meta-functions to search for relevant tools or toolpath segments on demand, keeping the active context focused on high-level reasoning. This architecture scales horizontally—adding more specialized agents rather than more tokens—ensuring that long-running manufacturing tasks remain reproducible and debuggable.

## Symmetry, Equivariance, and Geometric Consistency

A persistent challenge for token-native geometry is the model's inherent lack of 3D spatial awareness. Standard transformers are not naturally invariant to rotation or translation; a "chair" rotated by 90 degrees may be represented by a completely different set of token activations. Custom geometric kernels solve this through symmetry-aware modeling and equivariant neural networks.

### EquiCAD and SO(3)/O(3)-Equivariance

EquiCAD is a pioneering framework that systematically unifies SO(3)/O(3)-equivariant neural networks with graph-based reasoning for CAD data. By using a symmetry-preserving encoding scheme that decomposes geometric entities into irreducible representations, EquiCAD guarantees that the model's internal features remain consistent regardless of the object's orientation in space.

The architecture typically consists of three synergistic components:

- **Equivariant Encoder:** Preserves geometric symmetries and ensures rotation/translation invariance.
- **UV-Space CNN Branch:** Captures local surface patterns on parametric patches.
- **Graph Neural Network (GNN):** Aggregates the topological relationships between faces, edges, and vertices.

This triple-threat approach allows the model to outperform standard architectures on industrially relevant shapes with fine-grained attributes, such as mechanical parts with precise fillets and holes.

### Neurosymbolic Constraint Discovery

In parametric CAD, shapes are defined by programs with explicit and implicit constraints. Token-native models like ReparamCAD combine the reasoning power of LLMs with symbolic deductive reasoning to identify these constraints. By using ChatGPT to generate text prompts describing variations of an input model and stable diffusion to optimize CAD parameters, the system can discover geometric constraints that are common across all variations.

This "zero-shot" approach allows for the automatic construction of re-parameterization interfaces, where a user can manipulate a "manipulation parameter" (e.g., "chair back height") and the model ensures that all related geometric and topological constraints are satisfied in the background. This represents a shift from "Vibe Coding" to "Agentic Engineering," where the agent is not just suggesting code but is actively managing the structural integrity of the design.

## Hardware-Software Co-design and the Speed of Inference

The feasibility of manipulating 3D geometry at the token level is heavily dependent on the underlying hardware. Companies like NVIDIA and OpenAI are collaborating on "hardware/software co-design" to optimize token efficiency and inference speed for engineering tasks. The GB200-NVL72 platform, for example, is specifically designed to support the massive compute capacity required for more data-intensive modalities like visual and spatial data.

| Hardware Platform | Target Application | Performance Metric |
|---|---|---|
| NVIDIA GB200-NVL72 | Multi-agent 3D simulation. | Support for trillion-parameter agents. |
| NVIDIA H100 (4-GPU) | Token geometry extraction (Pile-10K). | 40 mins for 2242 long prompts. |
| AMD Genoa (192-core) | Intrinsic Dimension (ID) calculation. | 25 mins for 2242 prompts. |
| RTX 4090 GPU | BrepARG Inference. | 1.5 seconds per B-Rep model. |

With these optimizations, benchmarks report 2.93x faster inference for coding and engineering agents, signaling a shift away from "infinite compute" budgets toward highly efficient, specialized models. This efficiency is crucial for real-time applications such as robotic path planning or interactive CAD editing, where latency must remain below what humans can perceive.

## Kyvo: Multi-Modal Alignment of Structured 3D Scenes

The convergence of language, vision, and 3D geometry is perhaps best realized in the Kyvo framework. Kyvo extends a language-pretrained transformer with a structured 3D modality, encoding scenes as lists of objects defined by their 3D shape, pose, and position. This object-by-object tokenization scheme integrates seamlessly with image and text tokens, allowing any modality to serve as input or output.

### Compactness and Scene Complexity

A major innovation in Kyvo is its 3D tokenizer, which is optimized for compactness to represent multiple objects per scene. Prior 3D tokenizers like SAR3D or AToken were designed for single-asset generation and used thousands of tokens per object. Kyvo's approach allows it to reconstruct complex scenes (e.g., a room with furniture, decor, and lighting) while staying within the context limits of a standard transformer.

The practical implications of this alignment are profound. A designer can create complex scenes through natural language in a single forward pass, while a robot can parse a 2D image into a structured 3D scene composed of distinct objects. This capability enables tasks such as:

- **3D-Conditioned Image Generation:** Generating a photo-realistic image based on a tokenized 3D layout.
- **Image to 3D Prediction:** Predicting the shape, location, and pose of objects from a single image.
- **Object-Centric 3D Editing:** Modifying a scene by changing the text description of a specific object.

## Conclusions and Future Outlook

The transition toward token-native geometry represents a fundamental transformation in how artificial intelligence interacts with the physical world. By moving away from non-differentiable "company" approaches and embedding geometric reasoning directly into the token representations of large language models, the field is unlocking new levels of spatial intelligence. The internal manifolds of models like those found in the hardythomas000/token-native-geometry repository demonstrate that tokens are not just linguistic markers but are points on a structured geometric landscape.

Custom geometric kernels and lexicalized B-Rep representations allow transformers to bridge the gap between abstract thought and precise 3D engineering. When paired with agent-native CAM and toolpath generation, these models become capable of not just designing objects, but overseeing their entire manufacturing lifecycle with PhD-level reasoning and verified physical feasibility.

As hardware and software continue to converge, the "generative world model" will move beyond static 3D assets into editable, persistent 4D environments. The development of token-efficient architectures like MCP and the alignment of structured 3D modalities in frameworks like Kyvo ensure that this spatial intelligence will be both scalable and accessible. Ultimately, the ability of large language models to natively manipulate geometry at the token level is the key to creating machines that can truly perceive, understand, and interact with the continuous 3D world we inhabit.
