import re

with open('/app/bookforge_jsx.jsx', 'r') as f:
    lines = f.readlines()

def get_function_at(line_num):
    # Search backwards from line_num for the enclosing function definition
    depth = 0
    # Let's track functions by doing a forward parse up to line_num
    # Or building a stack of open functions
    pass

# Simple function scope tracker
stack = [] # list of (func_name, start_line, indent/brace_level)
line_func = {}

# Simple parser to find function headers and track scope using brace depth
brace_depth = 0
active_funcs = [] # list of (name, depth_at_start)

func_pattern = re.compile(r'(async\s+function\s+([A-Za-z0-9_]+)|function\s+([A-Za-z0-9_]+)|const\s+([A-Za-z0-9_]+)\s*=\_*\s*(async\s*)?\([^)]*\)\s*=>|const\s+([A-Za-z0-9_]+)\s*=\_*\s*async\s+function)')

for idx, line in enumerate(lines, 1):
    # Check if a function starts on this line
    # Match functions
    m1 = re.search(r'function\s+([A-Za-z0-9_]+)', line)
    m2 = re.search(r'const\s+([A-Za-z0-9_]+)\s*=\s*(async\s*)?\(', line)
    m3 = re.search(r'const\s+([A-Za-z0-9_]+)\s*=\s*async', line)
    
    # We can determine the current function name by keeping a stack based on brace depth or looking upward
    # Let's inspect all lines around 4569 to 5800 and runMangaResearch
